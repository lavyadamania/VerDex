// ============================================================
// Disclosure Routes — Victim-Controlled Disclosure System
// ============================================================
// Endpoints:
//   POST   /api/disclosure/request         — Submit disclosure request
//   GET    /api/disclosure/my-requests      — List victim's own requests
//   GET    /api/disclosure/case/:caseId     — Disclosure history for a case
//   PATCH  /api/disclosure/:id/review       — Admin approve/reject
//   POST   /api/disclosure/:id/revoke       — Victim revokes disclosure
//   GET    /api/disclosure/admin/pending     — Admin: list pending requests
//   GET    /api/disclosure/fields            — List disclosable fields
// ============================================================
const express = require('express');
const router = express.Router();
const { z } = require('zod');

const { authenticate } = require('../middleware/auth');
const { authorize, denyVisitor } = require('../middleware/rbac');
const { validate } = require('../middleware/validator');
const { auditMiddleware } = require('../middleware/audit');
const { AppError } = require('../middleware/errorHandler');
const DisclosureRequest = require('../models/DisclosureRequest');
const Case = require('../models/Case');
const logger = require('../utils/logger');
const {
  DISCLOSABLE_FIELDS,
  submitDisclosureRequest,
  reviewDisclosureRequest,
  revokeDisclosure,
  getDisclosureHistory,
} = require('../services/disclosureService');

// Audit writes
router.use(auditMiddleware('disclosure'));

// ============================================================
// Validation Schemas
// ============================================================
const submitSchema = z.object({
  case_id: z.string().min(1, 'Case ID is required'),
  requested_fields: z.array(z.string()).min(1, 'At least one field required'),
  justification: z.string().optional(),
});

const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  notes: z.string().optional(),
});

// ============================================================
// GET /api/disclosure/fields — List disclosable fields
// ============================================================
// Returns the list of fields that can be disclosed.
// Access: Public
// ============================================================
router.get('/fields', (req, res) => {
  res.json({
    success: true,
    data: {
      disclosable_fields: DISCLOSABLE_FIELDS,
      description: 'These are the fields a victim can choose to disclose publicly.',
    },
  });
});

// ============================================================
// POST /api/disclosure/request — Submit disclosure request
// ============================================================
// Victim selects which fields to disclose. An AI safety check
// is performed, and the request is sent for admin review.
// Access: victim only
// ============================================================
router.post('/request', authenticate, denyVisitor, validate(submitSchema), async (req, res, next) => {
  try {
    const { case_id, requested_fields, justification } = req.body;

    const result = await submitDisclosureRequest({
      caseId: case_id,
      userId: req.user._id,
      requestedFields: requested_fields,
      justification,
      auditInfo: {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.status(201).json({
      success: true,
      message: 'Disclosure request submitted. Awaiting admin review.',
      data: {
        request_id: result.request._id,
        case_id: result.request.case,
        requested_fields: result.request.requested_fields,
        status: result.request.status,
        safety_check: {
          passed: result.safetyCheck.passed,
          risk_level: result.safetyCheck.riskLevel,
          warnings: result.safetyCheck.warnings,
        },
      },
    });
  } catch (err) {
    if (err.message.includes('not found')) return next(new AppError(err.message, 404));
    if (err.message.includes('Only the case owner')) return next(new AppError(err.message, 403));
    if (err.message.includes('Invalid disclosure')) return next(new AppError(err.message, 400));
    if (err.message.includes('already have a pending')) return next(new AppError(err.message, 409));
    if (err.message.includes('At least one')) return next(new AppError(err.message, 400));
    next(err);
  }
});

// ============================================================
// GET /api/disclosure/my-requests — List victim's requests
// ============================================================
// Returns all disclosure requests made by the current user.
// Access: authenticated, non-visitor
// ============================================================
router.get('/my-requests', authenticate, denyVisitor, async (req, res, next) => {
  try {
    const requests = await DisclosureRequest.find({ requested_by: req.user._id })
      .populate('case', 'cnr_number case_type disclosure_mode disclosed_fields')
      .populate('reviewed_by', 'full_name email')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: {
        total: requests.length,
        requests,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/disclosure/case/:caseId — Disclosure history
// ============================================================
// Returns all disclosure requests for a specific case.
// Victims see their own; admin/staff see all.
// Access: authenticated
// ============================================================
router.get('/case/:caseId', authenticate, async (req, res, next) => {
  try {
    const { caseId } = req.params;

    const caseDoc = await Case.findById(caseId)
      .select('cnr_number disclosure_mode disclosed_fields victim_user')
      .lean();
    if (!caseDoc) throw new AppError('Case not found', 404);

    // Ownership check for non-admin
    if (!['admin', 'court_staff'].includes(req.user.role)) {
      if (caseDoc.victim_user?.toString() !== req.user._id.toString()) {
        throw new AppError('You can only view disclosure history for your own cases.', 403);
      }
    }

    const history = await getDisclosureHistory(caseId);

    res.json({
      success: true,
      data: {
        case_id: caseDoc._id,
        cnr_number: caseDoc.cnr_number,
        current_disclosure_mode: caseDoc.disclosure_mode,
        currently_disclosed_fields: caseDoc.disclosed_fields,
        total_requests: history.length,
        history,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/disclosure/:id/review — Admin approve/reject
// ============================================================
// Admin reviews a pending disclosure request.
// On approval, the case disclosure_mode and disclosed_fields
// are updated automatically.
// Access: admin only
// ============================================================
router.patch('/:id/review', authenticate, authorize('admin'), validate(reviewSchema), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { decision, notes } = req.body;

    const result = await reviewDisclosureRequest({
      requestId: id,
      adminId: req.user._id,
      decision,
      notes,
      auditInfo: {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: `Disclosure request ${decision}`,
      data: {
        request_id: result.request._id,
        status: result.request.status,
        case_updated: result.caseUpdated,
        reviewed_at: result.request.reviewed_at,
      },
    });
  } catch (err) {
    if (err.message.includes('not found')) return next(new AppError(err.message, 404));
    if (err.message.includes('already')) return next(new AppError(err.message, 409));
    if (err.message.includes('Decision must')) return next(new AppError(err.message, 400));
    next(err);
  }
});

// ============================================================
// POST /api/disclosure/:id/revoke — Victim revokes disclosure
// ============================================================
// Victim takes back a previously approved disclosure.
// Removes the disclosed fields from the case's public view.
// Access: authenticated, non-visitor (must be request owner)
// ============================================================
router.post('/:id/revoke', authenticate, denyVisitor, async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await revokeDisclosure({
      requestId: id,
      userId: req.user._id,
      auditInfo: {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    res.json({
      success: true,
      message: 'Disclosure revoked successfully. Fields removed from public view.',
      data: {
        request_id: result.request._id,
        status: 'revoked',
        case_disclosure_mode: result.caseDisclosureMode,
        remaining_disclosed_fields: result.remainingFields,
      },
    });
  } catch (err) {
    if (err.message.includes('not found')) return next(new AppError(err.message, 404));
    if (err.message.includes('Only the requester')) return next(new AppError(err.message, 403));
    if (err.message.includes('Can only revoke')) return next(new AppError(err.message, 400));
    next(err);
  }
});

// ============================================================
// GET /api/disclosure/admin/pending — Admin: pending requests
// ============================================================
// Lists all pending disclosure requests for admin review.
// Access: admin only
// ============================================================
router.get('/admin/pending', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip = (pageNum - 1) * limitNum;

    const [requests, total] = await Promise.all([
      DisclosureRequest.find({ status: 'pending' })
        .populate('case', 'cnr_number case_type')
        .populate('requested_by', 'full_name email')
        .sort({ createdAt: 1 }) // oldest first for review queue
        .skip(skip)
        .limit(limitNum)
        .lean(),
      DisclosureRequest.countDocuments({ status: 'pending' }),
    ]);

    res.json({
      success: true,
      data: {
        total_pending: total,
        requests,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
