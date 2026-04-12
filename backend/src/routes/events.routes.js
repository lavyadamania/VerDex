// ============================================================
// Events Routes — Real-Time Activity Feed API
// ============================================================
const express = require('express');
const router = express.Router();

const { authenticate, optionalAuth } = require('../middleware/auth');
const { AppError } = require('../middleware/errorHandler');
const { getVisibleEvents, getCaseEvents } = require('../services/eventService');
const logger = require('../utils/logger');

// ============================================================
// GET /api/events/live — Get recent events (initial load)
// ============================================================
// Returns latest events visible to the authenticated user.
// Used for:
//   - Initial dashboard load
//   - Pagination/history scroll
//   - Refetch after reconnection
// ============================================================
router.get('/live', authenticate, async (req, res, next) => {
  try {
    const { limit = 20, skip = 0 } = req.query;

    const result = await getVisibleEvents(req.user, limit, skip);

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/events/case/:caseId — Get events for a specific case
// ============================================================
// Returns all events for a case that the user has access to.
// Access: Only if user is victim/advocate of case or admin/court_staff
// ============================================================
router.get('/case/:caseId', authenticate, async (req, res, next) => {
  try {
    const { caseId } = req.params;
    const { limit = 50 } = req.query;

    const Case = require('../models/Case');
    const caseDoc = await Case.findById(caseId);

    if (!caseDoc) {
      throw new AppError('Case not found', 404);
    }

    // Access check
    const { role } = req.user;
    if (role === 'victim' && caseDoc.victim_user?.toString() !== req.user._id.toString()) {
      throw new AppError('Access denied. You can only view events for your own cases.', 403);
    }

    const events = await getCaseEvents(caseId, req.user, limit);

    res.json({
      success: true,
      data: {
        case_id: caseId,
        events,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/events/stats — Event statistics
// ============================================================
// Returns counts of event types and activity summary.
// ============================================================
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const Event = require('../models/Event');
    const { _id: userId, role } = req.user;

    // Get events visible to user
    const query = {
      $or: [
        { rolesVisibleTo: role },
        { usersVisibleTo: userId },
      ],
    };

    const [
      totalEvents,
      byType,
      last24h,
      topCases,
    ] = await Promise.all([
      Event.countDocuments(query),

      Event.aggregate([
        { $match: query },
        { $group: { _id: '$type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Event.countDocuments({
        ...query,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      }),

      Event.aggregate([
        { $match: query },
        { $group: { _id: '$caseId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: 'cases',
            localField: '_id',
            foreignField: '_id',
            as: 'case_info',
          },
        },
        { $unwind: { path: '$case_info', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            case_id: '$_id',
            case_number: '$case_info.cnr_number',
            event_count: '$count',
          },
        },
      ]),
    ]);

    const typeBreakdown = {};
    for (const t of byType) {
      typeBreakdown[t._id] = t.count;
    }

    res.json({
      success: true,
      data: {
        total_events: totalEvents,
        events_last_24h: last24h,
        by_type: typeBreakdown,
        top_cases: topCases,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/events/public — Public event stream (NO LOGIN REQUIRED)
// ============================================================
// Returns events visible to public/visitors (non-authenticated users).
// This allows real-time tracking without login.
// Only events with 'visitor' in rolesVisibleTo are included.
// ============================================================
router.get('/public', async (req, res, next) => {
  try {
    const { limit = 20, skip = 0 } = req.query;
    const Event = require('../models/Event');

    // Get events visible to visitors
    const query = {
      rolesVisibleTo: 'visitor',
    };

    const [events, total] = await Promise.all([
      Event.find(query)
        .sort({ createdAt: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .select('_id caseId type message metadata createdAt')
        .lean(),

      Event.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        events,
        total,
        page: Math.floor(skip / limit) + 1,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
