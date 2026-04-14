// ============================================================
// Court Routes — List & Details
// ============================================================
const express = require('express');
const router = express.Router();

const Court = require('../models/Court');
const Case = require('../models/Case');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// ============================================================
// GET /api/courts — List all courts
// ============================================================
router.get('/', async (req, res, next) => {
  try {
    const { state, district, type } = req.query;
    let filter = {};
    if (state) filter.state = new RegExp(state, 'i');
    if (district) filter.district = new RegExp(district, 'i');
    if (type) filter.court_type = type;

    const courts = await Court.find(filter)
      .sort({ state: 1, district: 1, court_name: 1 })
      .lean({ virtuals: true });

    res.json({
      success: true,
      data: {
        total: courts.length,
        courts,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/courts/:id — Court details with case stats
// ============================================================
// NOTE: Keep specific routes before '/:id' to avoid shadowing.
router.get('/leaderboard/rank', async (req, res, next) => {
  try {
    const courts = await Court.find()
      .lean({ virtuals: true });

    // Calculate performance score for each court
    const ranked = courts.map((court) => {
      const total = court.total_cases_filed || 1;
      const resolved = court.total_cases_resolved || 0;
      const rate = ((resolved / total) * 100).toFixed(1);
      return {
        court_id: court._id,
        court_name: court.court_name,
        district: court.district,
        state: court.state,
        total_cases_filed: total,
        total_cases_resolved: resolved,
        resolution_rate: parseFloat(rate),
      };
    });

    // Sort by resolution rate (higher is better)
    ranked.sort((a, b) => b.resolution_rate - a.resolution_rate);

    // Add rank
    ranked.forEach((c, i) => {
      c.rank = i + 1;
    });

    res.json({
      success: true,
      data: {
        total_courts: ranked.length,
        leaderboard: ranked,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/courts/:id — Court details with case stats
// ============================================================
router.get('/:id', async (req, res, next) => {
  try {
    const court = await Court.findById(req.params.id).lean({ virtuals: true });
    if (!court) {
      throw new AppError('Court not found', 404);
    }

    // Get case breakdown for this court
    const [casesByStatus, casesByType, recentCases] = await Promise.all([
      Case.aggregate([
        { $match: { court: court._id } },
        { $group: { _id: '$current_status', count: { $sum: 1 } } },
      ]),
      Case.aggregate([
        { $match: { court: court._id } },
        { $group: { _id: '$case_type', count: { $sum: 1 } } },
      ]),
      Case.find({ court: court._id })
        .select('cnr_number case_type current_status delay_risk_score filing_date')
        .sort({ last_update: -1 })
        .limit(5)
        .lean(),
    ]);

    res.json({
      success: true,
      data: {
        court,
        stats: {
          by_status: casesByStatus.reduce((a, s) => ({ ...a, [s._id]: s.count }), {}),
          by_type: casesByType.reduce((a, t) => ({ ...a, [t._id]: t.count }), {}),
        },
        recent_cases: recentCases,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
