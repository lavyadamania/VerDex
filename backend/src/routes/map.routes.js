// ============================================================
// Map Routes — Court Delay Heatmap API
// ============================================================
// Public API for the Snapchat-style court delay heatmap.
// Returns geo-located court data with JSI scores and risk levels.
//
// Endpoints:
//   GET /api/courts/map          — All courts with map data
//   GET /api/courts/map/stats    — Summary statistics for the map
//   GET /api/courts/map/:id      — Single court map detail
// ============================================================
const express = require('express');
const router = express.Router();

const { getMapData, MAP_KEYS } = require('../services/courtMapService');
const { computeDelayRisk, riskColor, riskSeverity } = require('../utils/delayRisk');
const Court = require('../models/Court');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');

// ============================================================
// GET /api/courts/map — All courts for the heatmap
// ============================================================
// Query params:
//   ?state=Delhi       — Filter by state
//   ?risk=HIGH         — Filter by delay_risk level
//
// Response: 200 with court array
// Redis cache: key "map:courts:all", TTL 60s
// BNS Section 72: No victim_count or individual identifiers
// ============================================================
router.get('/', async (req, res) => {
  try {
    const { state, risk } = req.query;

    const result = await getMapData({ state, risk });

    res.status(200).json({
      success: true,
      data: {
        total: result.total,
        fromCache: result.fromCache,
        timestamp: new Date().toISOString(),
        courts: result.courts,
      },
    });
  } catch (err) {
    logger.error(`[MapAPI] GET /api/courts/map failed: ${err.message}`);

    // Fallback: try direct MongoDB query if service threw
    try {
      const courts = await Court.find({
        lat: { $exists: true, $ne: null },
        lng: { $exists: true, $ne: null },
      }).lean();

      const fallback = courts.map(c => ({
        court_id: c._id.toString(),
        court_name: c.court_name,
        court_type: c.court_type,
        district: c.district,
        state: c.state,
        lat: c.lat,
        lng: c.lng,
        jsi_score: 50,       // default when computation unavailable
        pending_cases: 0,
        adjournment_rate: 0,
        stagnation_count: 0,
        delay_risk: 'MEDIUM',
        risk_color: riskColor('MEDIUM'),
        risk_severity: riskSeverity('MEDIUM'),
      }));

      return res.status(200).json({
        success: true,
        data: {
          total: fallback.length,
          fromCache: false,
          fallback: true,
          timestamp: new Date().toISOString(),
          courts: fallback,
        },
      });
    } catch (fallbackErr) {
      logger.error(`[MapAPI] Fallback query also failed: ${fallbackErr.message}`);
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve court map data',
      });
    }
  }
});

// ============================================================
// GET /api/courts/map/stats — Summary stats for the heatmap
// ============================================================
router.get('/stats', async (req, res) => {
  try {
    const result = await getMapData();
    const courts = result.courts;

    const stats = {
      total_courts: courts.length,
      risk_breakdown: {
        LOW: courts.filter(c => c.delay_risk === 'LOW').length,
        MEDIUM: courts.filter(c => c.delay_risk === 'MEDIUM').length,
        HIGH: courts.filter(c => c.delay_risk === 'HIGH').length,
        CRITICAL: courts.filter(c => c.delay_risk === 'CRITICAL').length,
      },
      avg_jsi: courts.length > 0
        ? parseFloat((courts.reduce((s, c) => s + c.jsi_score, 0) / courts.length).toFixed(2))
        : 0,
      total_pending_cases: courts.reduce((s, c) => s + (c.pending_cases || 0), 0),
      total_stagnant_cases: courts.reduce((s, c) => s + (c.stagnation_count || 0), 0),
      states_covered: [...new Set(courts.map(c => c.state))].sort(),
      fromCache: result.fromCache,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json({ success: true, data: stats });
  } catch (err) {
    logger.error(`[MapAPI] GET /api/courts/map/stats failed: ${err.message}`);
    res.status(500).json({ success: false, error: 'Failed to retrieve map statistics' });
  }
});

// ============================================================
// GET /api/courts/map/:id — Single court map detail
// ============================================================
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  const redis = getRedis();

  try {
    // Try Redis mapdata hash first
    let mapData = null;
    try {
      const cached = await redis.hgetall(MAP_KEYS.COURT_MAPDATA(id));
      if (cached && Object.keys(cached).length > 0) {
        mapData = cached;
      }
    } catch (err) {
      logger.error(`[MapAPI] Redis hgetall failed for court ${id}: ${err.message}`);
    }

    // Get court document from MongoDB
    const court = await Court.findById(id).lean();
    if (!court) {
      return res.status(404).json({ success: false, error: 'Court not found' });
    }

    if (!court.lat || !court.lng) {
      return res.status(404).json({ success: false, error: 'Court has no geo coordinates' });
    }

    const response = {
      court_id: court._id.toString(),
      court_name: court.court_name,
      court_type: court.court_type,
      district: court.district,
      state: court.state,
      lat: court.lat,
      lng: court.lng,
      jsi_score: mapData ? parseFloat(mapData.jsi_score) : null,
      pending_cases: mapData ? parseInt(mapData.pending_cases, 10) : null,
      adjournment_rate: mapData ? parseFloat(mapData.adjournment_rate) : null,
      stagnation_count: mapData ? parseInt(mapData.stagnation_count, 10) : null,
      delay_risk: mapData ? mapData.delay_risk : null,
      risk_color: mapData ? mapData.risk_color : null,
      last_updated: mapData ? mapData.updated_at : null,
      fromCache: !!mapData,
    };

    res.status(200).json({ success: true, data: response });
  } catch (err) {
    logger.error(`[MapAPI] GET /api/courts/map/${id} failed: ${err.message}`);
    res.status(500).json({ success: false, error: 'Failed to retrieve court map data' });
  }
});

module.exports = router;
