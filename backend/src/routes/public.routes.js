// ============================================================
// Public Dashboard Routes — Anonymized Public Access
// ============================================================
// All endpoints are PUBLIC (no auth required).
// CRITICAL: No private data (victim name, contact, statement)
// must ever leak through these endpoints.
//
// Endpoints:
//   GET /api/public/cases          — Anonymized case listing
//   GET /api/public/cases/:maskedId — Anonymized case detail
//   GET /api/public/stats           — System-wide statistics
//   GET /api/public/courts          — Court performance public view
//   GET /api/public/courts/:id      — Single court public stats
// ============================================================
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Case = require('../models/Case');
const Court = require('../models/Court');
const { getRedis } = require('../config/redis');
const { REDIS_KEYS } = require('../services/leaderboardService');
const logger = require('../utils/logger');

// ============================================================
// GET /api/public/cases — Anonymized case listing
// ============================================================
// Query params:
//   page (default: 1)
//   limit (default: 20, max: 100)
//   status (filter by current_status)
//   case_type (filter by type)
//   court (filter by court ID)
//   sort (field to sort: filing_date, delay_risk_score, adjournment_count)
//   order (asc or desc, default: desc)
//   search (text search on cnr_number — partial match)
//
// Returns ONLY anonymized data. No victim info ever returned.
// ============================================================
router.get('/cases', async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      case_type,
      court,
      sort = 'filing_date',
      order = 'desc',
      search,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(Math.max(1, parseInt(limit)), 100);
    const skip = (pageNum - 1) * limitNum;

    // Build query
    const query = {};

    if (status) {
      const validStatuses = ['filed', 'hearing', 'evidence', 'arguments', 'reserved', 'judgment', 'disposed', 'appealed'];
      if (validStatuses.includes(status)) {
        query.current_status = status;
      }
    }

    if (case_type) {
      query.case_type = case_type;
    }

    if (court) {
      if (mongoose.Types.ObjectId.isValid(court)) {
        query.court = court;
      }
    }

    if (search) {
      query.cnr_number = { $regex: search, $options: 'i' };
    }

    // Build sort
    const allowedSorts = ['filing_date', 'delay_risk_score', 'adjournment_count', 'last_update', 'createdAt'];
    const sortField = allowedSorts.includes(sort) ? sort : 'filing_date';
    const sortOrder = order === 'asc' ? 1 : -1;

    const [cases, total] = await Promise.all([
      Case.find(query)
        .populate('court', 'court_name district state court_type')
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limitNum),
      Case.countDocuments(query),
    ]);

    // Anonymize every case — CRITICAL: strips all private data
    const anonymized = cases.map(c => c.toAnonymized());

    res.json({
      success: true,
      data: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
        cases: anonymized,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/public/cases/:maskedId — Anonymized case detail
// ============================================================
// Looks up a case by its masked ID (e.g., CT-A1B2C3).
// Returns anonymized data only.
// ============================================================
router.get('/cases/:maskedId', async (req, res, next) => {
  try {
    const { maskedId } = req.params;

    // Masked ID format: CT-XXXXXX (last 6 chars of ObjectId, uppercased)
    if (!maskedId || !maskedId.startsWith('CT-') || maskedId.length !== 9) {
      return res.status(400).json({
        success: false,
        error: 'Invalid masked ID format. Expected: CT-XXXXXX',
      });
    }

    const suffix = maskedId.slice(3).toLowerCase();

    // Find case where _id ends with this suffix
    const allCases = await Case.find()
      .populate('court', 'court_name district state court_type')
      .lean();

    const matchedCase = allCases.find(c => c._id.toString().slice(-6) === suffix);

    if (!matchedCase) {
      return res.status(404).json({
        success: false,
        error: 'Case not found',
      });
    }

    // Re-fetch as Mongoose document for toAnonymized()
    const caseDoc = await Case.findById(matchedCase._id)
      .populate('court', 'court_name district state court_type');

    const anonymized = caseDoc.toAnonymized();

    // Add event count (without exposing event details publicly)
    const CaseEvent = require('../models/CaseEvent');
    const eventCount = await CaseEvent.countDocuments({ case: matchedCase._id });
    anonymized.total_events = eventCount;

    res.json({
      success: true,
      data: {
        case: anonymized,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/public/stats — System-wide statistics
// ============================================================
// Returns aggregate stats. No private data.
// ============================================================
router.get('/stats', async (req, res, next) => {
  try {
    const redis = getRedis();

    // Try cached stats first
    let cachedStats = await redis.hgetall(REDIS_KEYS.SYSTEM_STATS);

    // Compute live stats from MongoDB
    const [
      totalCases,
      statusCounts,
      typeCounts,
      avgDelay,
      totalCourts,
      recentCases,
    ] = await Promise.all([
      Case.countDocuments(),

      Case.aggregate([
        { $group: { _id: '$current_status', count: { $sum: 1 } } },
      ]),

      Case.aggregate([
        { $group: { _id: '$case_type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Case.aggregate([
        { $match: { current_status: { $nin: ['disposed', 'judgment'] } } },
        {
          $group: {
            _id: null,
            avg_delay_score: { $avg: '$delay_risk_score' },
            avg_adjournments: { $avg: '$adjournment_count' },
            stagnant_count: { $sum: { $cond: ['$stagnation_flag', 1, 0] } },
          },
        },
      ]),

      Court.countDocuments(),

      Case.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    // Build status breakdown
    const byStatus = {};
    for (const s of statusCounts) {
      byStatus[s._id] = s.count;
    }

    // Build type breakdown
    const byType = {};
    for (const t of typeCounts) {
      byType[t._id] = t.count;
    }

    const delayStats = avgDelay[0] || { avg_delay_score: 0, avg_adjournments: 0, stagnant_count: 0 };
    const resolvedCount = (byStatus.disposed || 0) + (byStatus.judgment || 0);
    const pendingCount = totalCases - resolvedCount;

    res.json({
      success: true,
      data: {
        overview: {
          total_cases: totalCases,
          total_resolved: resolvedCount,
          total_pending: pendingCount,
          total_courts: totalCourts,
          cases_filed_last_30_days: recentCases,
          resolution_rate: totalCases > 0
            ? parseFloat(((resolvedCount / totalCases) * 100).toFixed(2))
            : 0,
        },
        by_status: byStatus,
        by_case_type: byType,
        delay_metrics: {
          avg_delay_risk_score: parseFloat((delayStats.avg_delay_score || 0).toFixed(2)),
          avg_adjournments: parseFloat((delayStats.avg_adjournments || 0).toFixed(2)),
          stagnant_cases: delayStats.stagnant_count || 0,
        },
        cached_leaderboard_stats: cachedStats && Object.keys(cachedStats).length > 0
          ? cachedStats
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/public/courts — Court performance public view
// ============================================================
// Returns all courts with basic performance metrics.
// Query params:
//   state (filter by state)
//   sort (court_name, total_cases_filed, total_cases_resolved)
//   order (asc/desc)
// ============================================================
router.get('/courts', async (req, res, next) => {
  try {
    const { state, sort = 'court_name', order = 'asc' } = req.query;

    const query = {};
    if (state) {
      query.state = { $regex: state, $options: 'i' };
    }

    const allowedSorts = ['court_name', 'total_cases_filed', 'total_cases_resolved', 'district', 'state'];
    const sortField = allowedSorts.includes(sort) ? sort : 'court_name';
    const sortOrder = order === 'desc' ? -1 : 1;

    const courts = await Court.find(query)
      .select('court_name court_type district state total_cases_filed total_cases_resolved')
      .sort({ [sortField]: sortOrder })
      .lean();

    // Add derived stats
    const courtsWithStats = courts.map(c => ({
      ...c,
      total_pending: (c.total_cases_filed || 0) - (c.total_cases_resolved || 0),
      resolution_rate: c.total_cases_filed > 0
        ? parseFloat(((c.total_cases_resolved || 0) / c.total_cases_filed * 100).toFixed(2))
        : 0,
    }));

    res.json({
      success: true,
      data: {
        total: courtsWithStats.length,
        courts: courtsWithStats,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/public/courts/:id — Single court public stats
// ============================================================
// Returns public-safe stats for a specific court.
// ============================================================
router.get('/courts/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, error: 'Invalid court ID' });
    }

    const court = await Court.findById(id)
      .select('court_name court_type district state total_cases_filed total_cases_resolved')
      .lean();

    if (!court) {
      return res.status(404).json({ success: false, error: 'Court not found' });
    }

    // Get case breakdown for this court
    const [statusBreakdown, typeBreakdown] = await Promise.all([
      Case.aggregate([
        { $match: { court: new mongoose.Types.ObjectId(id) } },
        { $group: { _id: '$current_status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Case.aggregate([
        { $match: { court: new mongoose.Types.ObjectId(id) } },
        { $group: { _id: '$case_type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const byStatus = {};
    for (const s of statusBreakdown) byStatus[s._id] = s.count;

    const byType = {};
    for (const t of typeBreakdown) byType[t._id] = t.count;

    const totalFiled = court.total_cases_filed || 0;
    const totalResolved = court.total_cases_resolved || 0;

    res.json({
      success: true,
      data: {
        court: {
          id: court._id,
          name: court.court_name,
          type: court.court_type,
          district: court.district,
          state: court.state,
        },
        performance: {
          total_cases_filed: totalFiled,
          total_cases_resolved: totalResolved,
          total_pending: totalFiled - totalResolved,
          resolution_rate: totalFiled > 0
            ? parseFloat(((totalResolved / totalFiled) * 100).toFixed(2))
            : 0,
        },
        breakdowns: {
          by_status: byStatus,
          by_case_type: byType,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
