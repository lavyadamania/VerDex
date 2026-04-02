// ============================================================
// Leaderboard & Analytics Routes
// ============================================================
// Public leaderboard endpoint + admin analytics.
//
// Endpoints:
//   GET  /api/leaderboard             — Public court rankings
//   GET  /api/leaderboard/stats       — System-wide statistics
//   GET  /api/leaderboard/court/:id   — Detailed court analytics (admin)
//   POST /api/leaderboard/refresh     — Manual refresh trigger (admin)
// ============================================================
const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { AppError } = require('../middleware/errorHandler');
const { createAuditEntry } = require('../middleware/audit');
const {
  getLeaderboard,
  computeLeaderboard,
  getCourtAnalytics,
  REDIS_KEYS,
} = require('../services/leaderboardService');
const { getRedis } = require('../config/redis');
const Court = require('../models/Court');
const logger = require('../utils/logger');

// ============================================================
// GET /api/leaderboard — Public court performance rankings
// ============================================================
// Query params:
//   limit: max courts (default: all)
//   state: filter by state (optional)
//
// Access: Public (no auth required)
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const { limit, state } = req.query;

    const result = await getLeaderboard({
      limit: limit ? parseInt(limit) : 0,
      state: state || null,
    });

    res.json({
      success: true,
      data: {
        total_courts: result.leaderboard.length,
        from_cache: result.fromCache,
        leaderboard: result.leaderboard,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/leaderboard/stats — System-wide statistics
// ============================================================
// Returns aggregate stats across all courts.
// Access: Public
// ============================================================
router.get('/stats', async (req, res, next) => {
  try {
    const redis = getRedis();
    let stats = await redis.hgetall(REDIS_KEYS.SYSTEM_STATS);

    // If no cached stats, compute fresh
    if (!stats || Object.keys(stats).length === 0) {
      const result = await computeLeaderboard();
      stats = result.systemStats;
    }

    const lastRefresh = await redis.get(REDIS_KEYS.LAST_REFRESH);

    res.json({
      success: true,
      data: {
        statistics: stats,
        last_refreshed: lastRefresh || 'never',
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/leaderboard/court/:id — Detailed court analytics
// ============================================================
// Returns full breakdown for a specific court.
// Access: admin, court_staff
// ============================================================
router.get('/court/:id', authenticate, authorize('admin', 'court_staff'), async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify court exists
    const court = await Court.findById(id).lean();
    if (!court) {
      throw new AppError('Court not found', 404);
    }

    const analytics = await getCourtAnalytics(id);

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
        performance: analytics.metrics,
        breakdowns: analytics.breakdowns,
        top_delayed_cases: analytics.top_delayed_cases,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/leaderboard/refresh — Manual leaderboard refresh
// ============================================================
// Triggers a full recomputation of all court rankings.
// Access: admin only
// ============================================================
router.post('/refresh', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    logger.info(`📊 Manual leaderboard refresh triggered by ${req.user.email}`);

    const result = await computeLeaderboard();

    await createAuditEntry({
      userId: req.user._id,
      action: 'leaderboard.manual_refresh',
      entityType: 'system',
      entityId: null,
      newValue: { courts_ranked: result.courts.length, elapsed: result.elapsed },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: 'Leaderboard refreshed successfully',
      data: {
        courts_ranked: result.courts.length,
        system_stats: result.systemStats,
        elapsed_seconds: result.elapsed,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
