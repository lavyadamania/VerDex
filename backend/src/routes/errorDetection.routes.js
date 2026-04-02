// ============================================================
// Error Detection Routes — Stage 17
// ============================================================
// Admin/staff endpoints for scanning cases, viewing error
// summaries, and listing cases with detected errors.
// ============================================================
const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware } = require('../middleware/audit');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const {
  scanCaseForErrors,
  scanAllCasesForErrors,
  getErrorSummary,
} = require('../services/errorDetectionService');

// Audit all writes
router.use(auditMiddleware('error_detection'));

// ============================================================
// POST /api/errors/scan/:caseId — Scan a single case
// ============================================================
// Runs all error checks on one case and optionally creates alerts.
// Admin and court_staff only.
// ============================================================
router.post('/scan/:caseId', authenticate, authorize('admin', 'court_staff'), async (req, res, next) => {
  try {
    const { caseId } = req.params;
    const generateAlerts = req.query.alerts !== 'false'; // default true

    const result = await scanCaseForErrors(caseId, { generateAlerts });

    logger.info(`🔍 Case scan requested: ${caseId} by ${req.user.email} — ${result.errors.length} errors`);

    res.json({
      success: true,
      message: result.errors.length > 0
        ? `Found ${result.errors.length} error(s) in case ${result.cnr_number}`
        : `No errors found in case ${result.cnr_number}`,
      data: result,
    });
  } catch (err) {
    if (err.message && err.message.includes('Case not found')) {
      return next(new AppError('Case not found', 404));
    }
    next(err);
  }
});

// ============================================================
// POST /api/errors/scan-all — Scan all active cases (admin only)
// ============================================================
// Bulk scan — iterates through all non-disposed cases.
// Can be slow for large datasets; returns summary + details.
// ============================================================
router.post('/scan-all', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const generateAlerts = req.query.alerts !== 'false';

    logger.info(`🔍 Bulk error scan triggered by ${req.user.email}`);

    const result = await scanAllCasesForErrors({ generateAlerts });

    res.json({
      success: true,
      message: `Scanned ${result.totalCasesScanned} cases — ${result.totalErrors} errors found across ${result.casesWithErrors} cases`,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/errors/summary — Error summary stats
// ============================================================
// Returns aggregate counts of error_detected alerts.
// Admin and court_staff only.
// ============================================================
router.get('/summary', authenticate, authorize('admin', 'court_staff'), async (req, res, next) => {
  try {
    const summary = await getErrorSummary();

    res.json({
      success: true,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/errors/cases — List cases with detected errors
// ============================================================
// Returns recent error_detected alerts grouped by case,
// with pagination support.
// ============================================================
router.get('/cases', authenticate, authorize('admin', 'court_staff'), async (req, res, next) => {
  try {
    const Alert = require('../models/Alert');
    const { page = 1, limit = 20, severity } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter
    const filter = { alert_type: 'error_detected', is_dismissed: { $ne: true } };
    if (severity) filter.severity = severity;

    const [alerts, total] = await Promise.all([
      Alert.find(filter)
        .populate('case', 'cnr_number case_type current_status court delay_risk_score')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Alert.countDocuments(filter),
    ]);

    // Group alerts by case for a cleaner response
    const caseMap = {};
    for (const alert of alerts) {
      const caseId = alert.case?._id?.toString() || 'unknown';
      if (!caseMap[caseId]) {
        caseMap[caseId] = {
          case: alert.case,
          errors: [],
        };
      }
      caseMap[caseId].errors.push({
        alert_id: alert._id,
        title: alert.alert_title,
        message: alert.alert_message,
        severity: alert.severity,
        is_read: alert.is_read,
        created_at: alert.createdAt,
      });
    }

    const grouped = Object.values(caseMap);

    res.json({
      success: true,
      data: {
        cases_with_errors: grouped,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
