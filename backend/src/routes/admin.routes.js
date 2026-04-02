// ============================================================
// Admin Dashboard Routes
// ============================================================
// Endpoints:
//   GET  /api/admin/stats           — High-level system stats
//   GET  /api/admin/cases           — All cases with advanced filters
//   GET  /api/admin/stuck-cases     — Stuck cases by delay risk
//   GET  /api/admin/court-analytics — Court-wise analytics
//   GET  /api/admin/audit-logs      — Audit log viewer
//   GET  /api/admin/users           — User management view
//
// Access: admin only (all endpoints)
// ============================================================
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { AppError } = require('../middleware/errorHandler');
const Case = require('../models/Case');
const User = require('../models/User');
const {
  getAdminStats,
  getStuckCases,
  getCourtAnalytics,
  getAuditLogs,
} = require('../services/adminService');

// All admin routes require authentication + admin role
router.use(authenticate);
router.use(authorize('admin'));

// ============================================================
// GET /api/admin/stats — High-level system statistics
// ============================================================
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await getAdminStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/admin/cases — All cases with advanced filters
// ============================================================
// Query params:
//   page, limit, status, case_type, court, sort, order
//   min_delay, max_delay — filter by delay_risk_score range
//   stagnant — boolean, filter stagnant cases only
//   search — CNR number partial match
// ============================================================
router.get('/cases', async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 25,
      status,
      case_type,
      court,
      sort = 'createdAt',
      order = 'desc',
      min_delay,
      max_delay,
      stagnant,
      search,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(Math.max(1, parseInt(limit)), 100);
    const skip = (pageNum - 1) * limitNum;

    const query = {};

    if (status) query.current_status = status;
    if (case_type) query.case_type = case_type;
    if (court && mongoose.Types.ObjectId.isValid(court)) query.court = court;
    if (stagnant === 'true') query.stagnation_flag = true;
    if (search) query.cnr_number = { $regex: search, $options: 'i' };

    // Delay risk range
    if (min_delay || max_delay) {
      query.delay_risk_score = {};
      if (min_delay) query.delay_risk_score.$gte = parseInt(min_delay);
      if (max_delay) query.delay_risk_score.$lte = parseInt(max_delay);
    }

    const allowedSorts = [
      'createdAt', 'filing_date', 'delay_risk_score',
      'adjournment_count', 'last_update', 'current_status',
    ];
    const sortField = allowedSorts.includes(sort) ? sort : 'createdAt';
    const sortOrder = order === 'asc' ? 1 : -1;

    const [cases, total] = await Promise.all([
      Case.find(query)
        .populate('court', 'court_name district state')
        .populate('victim_user', 'full_name email phone verification_status')
        .sort({ [sortField]: sortOrder })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Case.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
        cases,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/admin/stuck-cases — Stuck cases (high delay risk)
// ============================================================
// Query params:
//   page, limit, threshold (default: 7)
// ============================================================
router.get('/stuck-cases', async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      threshold = 7,
    } = req.query;

    const result = await getStuckCases({
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
      threshold: parseInt(threshold),
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
// GET /api/admin/court-analytics — Court-wise analytics
// ============================================================
router.get('/court-analytics', async (req, res, next) => {
  try {
    const analytics = await getCourtAnalytics();
    res.json({
      success: true,
      data: {
        total_courts: analytics.length,
        courts: analytics,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/admin/audit-logs — Audit log viewer
// ============================================================
// Query params:
//   page, limit, action, user_id, entity_type
// ============================================================
router.get('/audit-logs', async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 50,
      action,
      user_id,
      entity_type,
    } = req.query;

    const result = await getAuditLogs({
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 200),
      action,
      userId: user_id,
      entityType: entity_type,
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
// GET /api/admin/users — User management view
// ============================================================
// Query params:
//   page, limit, role, verification_status, search
// ============================================================
router.get('/users', async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 25,
      role,
      verification_status,
      search,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(Math.max(1, parseInt(limit)), 100);
    const skip = (pageNum - 1) * limitNum;

    const query = {};
    if (role) query.role = role;
    if (verification_status) query.verification_status = verification_status;
    if (search) {
      query.$or = [
        { full_name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select('-password_hash -otp_code -otp_expires_at')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum),
        users,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
