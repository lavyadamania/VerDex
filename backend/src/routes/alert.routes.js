// ============================================================
// Alert Routes — User Alert Management APIs
// ============================================================
// Provides CRUD endpoints for viewing, managing, and interacting
// with alerts. Victims see their own alerts; admins can see all.
//
// Endpoints:
//   GET    /api/alerts           — List user's alerts (paginated, filterable)
//   GET    /api/alerts/count     — Get unread alert count (for badge)
//   PATCH  /api/alerts/:id/read  — Mark single alert as read
//   PATCH  /api/alerts/read-all  — Mark all alerts as read
//   PATCH  /api/alerts/:id/dismiss — Dismiss (soft-delete) an alert
//   GET    /api/alerts/admin/all — Admin: list all alerts system-wide
// ============================================================
const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { AppError } = require('../middleware/errorHandler');
const {
  getUserAlerts,
  markAlertRead,
  markAllAlertsRead,
  dismissAlert,
  getUnreadCount,
} = require('../services/alertService');
const Alert = require('../models/Alert');
const logger = require('../utils/logger');

// ============================================================
// GET /api/alerts — List current user's alerts
// ============================================================
// Query params:
//   page:   page number (default: 1)
//   limit:  items per page (default: 20)
//   filter: 'all' | 'unread' | 'read' (default: 'all')
//   type:   alert_type filter (optional)
//
// Access: any authenticated user
// ============================================================
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { page = 1, limit = 20, filter = 'all', type } = req.query;

    const result = await getUserAlerts(req.user._id, {
      page: parseInt(page),
      limit: parseInt(limit),
      filter,
      type: type || null,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/alerts/count — Get unread alert count
// ============================================================
// Returns just the count (for notification badges).
// Access: any authenticated user
// ============================================================
router.get('/count', authenticate, async (req, res, next) => {
  try {
    const count = await getUnreadCount(req.user._id);

    res.json({
      success: true,
      data: { unread_count: count },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/alerts/read-all — Mark all alerts as read
// ============================================================
// Marks every unread alert for the current user as read.
// Access: any authenticated user
// ============================================================
router.patch('/read-all', authenticate, async (req, res, next) => {
  try {
    const count = await markAllAlertsRead(req.user._id);

    res.json({
      success: true,
      message: `${count} alert(s) marked as read`,
      data: { marked_count: count },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/alerts/:id/read — Mark single alert as read
// ============================================================
// Access: owner of the alert only
// ============================================================
router.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    const alert = await markAlertRead(req.params.id, req.user._id);

    if (!alert) {
      throw new AppError('Alert not found or you do not own this alert', 404);
    }

    res.json({
      success: true,
      message: 'Alert marked as read',
      data: { alert },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/alerts/:id/dismiss — Dismiss an alert
// ============================================================
// Soft-deletes the alert (won't show in future queries).
// Access: owner of the alert only
// ============================================================
router.patch('/:id/dismiss', authenticate, async (req, res, next) => {
  try {
    const alert = await dismissAlert(req.params.id, req.user._id);

    if (!alert) {
      throw new AppError('Alert not found or you do not own this alert', 404);
    }

    res.json({
      success: true,
      message: 'Alert dismissed',
      data: { alert },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/alerts/admin/all — Admin: list all alerts system-wide
// ============================================================
// Query params:
//   page:     page number (default: 1)
//   limit:    items per page (default: 50)
//   type:     alert_type filter (optional)
//   severity: severity filter (optional)
//   userId:   filter by specific user (optional)
//
// Access: admin, court_staff
// ============================================================
router.get('/admin/all', authenticate, authorize('admin', 'court_staff'), async (req, res, next) => {
  try {
    const { page = 1, limit = 50, type, severity, userId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {};
    if (type) query.alert_type = type;
    if (severity) query.severity = severity;
    if (userId) query.user = userId;

    const [alerts, total, typeCounts] = await Promise.all([
      Alert.find(query)
        .populate('case', 'cnr_number case_type current_status')
        .populate('user', 'full_name email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Alert.countDocuments(query),
      // Aggregate alert counts by type
      Alert.aggregate([
        { $match: query },
        { $group: { _id: '$alert_type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        alerts,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit)),
        },
        type_counts: typeCounts.reduce((acc, t) => {
          acc[t._id] = t.count;
          return acc;
        }, {}),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
