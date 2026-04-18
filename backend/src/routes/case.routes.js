// ============================================================
// Case Routes — Full CRUD with RBAC
// ============================================================
const express = require('express');
const router = express.Router();
const { z } = require('zod');

const Case = require('../models/Case');
const CaseEvent = require('../models/CaseEvent');
const Court = require('../models/Court');
const { validate } = require('../middleware/validator');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { authorize, denyVisitor, readOnlyForVisitor, requireVerification, isOwnerOrAdmin } = require('../middleware/rbac');
const { auditMiddleware, createAuditEntry } = require('../middleware/audit');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { isCaseOwnerRole, normalizeRole } = require('../utils/roles');
const { syncCaseToRedis, syncCourtStatsToRedis, deleteCaseCache } = require('../utils/caseCache');
const { emitCaseEvent } = require('../services/eventService');

// Audit all writes
router.use(auditMiddleware('case'));

// ============================================================
// Validation Schemas
// ============================================================
const createCaseSchema = z.object({
  cnr_number: z.string().min(5, 'CNR number is required'),
  case_number: z.string().optional(),
  case_type: z.enum(['sexual_assault', 'domestic_violence', 'dowry', 'kidnapping',
    'murder', 'fraud', 'theft', 'cybercrime', 'other']),
  case_title: z.string().optional(),
  court_id: z.string().min(1, 'Court ID is required'),
  filing_date: z.string().min(1, 'Filing date is required'),
  accused_id: z.string().optional(),
  victim_id: z.string().optional(),
  judge_id: z.string().optional(),
  accused_name: z.string().optional(),
  judge_name: z.string().optional(),
  advocate_name: z.string().optional(),
  advocate_contact: z.string().optional(),
  victim_statement: z.string().optional(),
});

const updateCaseSchema = z.object({
  case_title: z.string().optional(),
  current_status: z.enum(['filed', 'hearing', 'evidence', 'arguments',
    'reserved', 'judgment', 'disposed', 'appealed']).optional(),
  next_hearing_date: z.string().optional(),
  accused_id: z.string().optional(),
  victim_id: z.string().optional(),
  judge_id: z.string().optional(),
  accused_name: z.string().optional(),
  judge_name: z.string().optional(),
  advocate_name: z.string().optional(),
  advocate_contact: z.string().optional(),
  disclosure_mode: z.enum(['private', 'partial', 'full']).optional(),
  disclosed_fields: z.array(z.string()).optional(),
});

const addEventSchema = z.object({
  event_type: z.enum(['filing', 'hearing', 'adjournment', 'order',
    'evidence_submitted', 'argument', 'judgment',
    'notice', 'transfer', 'other']),
  event_date: z.string().min(1, 'Event date is required'),
  event_description: z.string().optional(),
  adjournment_reason: z.string().optional(),
  order_summary: z.string().optional(),
  is_public: z.boolean().default(false),
});

// ============================================================
// GET /api/cases — List cases (role-based filtering)
// ============================================================
// Uses optionalAuth: logged-in users get role-based view,
// unauthenticated users get anonymized public view (same as visitor)
// ============================================================
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const role = req.user ? normalizeRole(req.user.role) : 'visitor';
    const { status, case_type, court_id, page = 1, limit = 20, sort = '-last_update' } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    let filter = {};

    // Role-based filtering
    if (isCaseOwnerRole(role)) {
      filter.victim_user = req.user._id;
    }
    // visitor / unauthenticated / admin / court_staff → see all cases

    // Optional query filters
    if (status) filter.current_status = status;
    if (case_type) filter.case_type = case_type;
    if (court_id) filter.court = court_id;

    const isPublicView = (role === 'visitor');

    const [cases, total] = await Promise.all([
      Case.find(filter)
        .populate('court', 'court_name district state court_type')
        .populate(isPublicView ? '' : 'victim_user', isPublicView ? undefined : 'full_name email')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean({ virtuals: true }),
      Case.countDocuments(filter),
    ]);

    // Anonymize for visitors / unauthenticated users
    let responseData;
    if (isPublicView) {
      responseData = cases.map(c => {
        const caseDoc = new Case(c);
        return caseDoc.toAnonymized();
      });
    } else {
      responseData = cases;
    }

    res.json({
      success: true,
      data: {
        cases: responseData,
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

// ============================================================
// GET /api/cases/stats — Case statistics (public)
// ============================================================
// No auth required — only aggregate counts, no sensitive data
// ============================================================
router.get('/stats', async (req, res, next) => {
  try {
    const [
      total,
      byStatus,
      byType,
      highRisk,
      stagnant,
      avgAdjournments,
    ] = await Promise.all([
      Case.countDocuments(),
      Case.aggregate([
        { $group: { _id: '$current_status', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Case.aggregate([
        { $group: { _id: '$case_type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Case.countDocuments({ delay_risk_score: { $gte: 7 } }),
      Case.countDocuments({ stagnation_flag: true }),
      Case.aggregate([
        { $group: { _id: null, avg: { $avg: '$adjournment_count' } } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        total_cases: total,
        high_risk_cases: highRisk,
        stagnant_cases: stagnant,
        avg_adjournments: avgAdjournments[0]?.avg?.toFixed(1) || 0,
        by_status: byStatus.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
        by_type: byType.reduce((acc, t) => ({ ...acc, [t._id]: t.count }), {}),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/cases/:id — Get single case (RBAC enforced)
// ============================================================
// Uses optionalAuth: visitors/public see anonymized data
// + disclosed fields + public timeline events.
// Authenticated owners/admin see full data.
// ============================================================
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const role = req.user ? normalizeRole(req.user.role) : 'visitor';
    const isPublicView = (role === 'visitor');

    const caseDoc = await Case.findById(req.params.id)
      .populate('court', 'court_name district state court_type pin_code')
      .populate(isPublicView ? '' : 'victim_user', isPublicView ? undefined : 'full_name email phone');

    if (!caseDoc) {
      throw new AppError('Case not found', 404);
    }

    // Visitors / unauthenticated → anonymized + disclosed fields + public timeline
    if (isPublicView) {
      // Get public timeline events (only events marked as public)
      const publicEvents = await CaseEvent.find({ case: caseDoc._id, is_public: true })
        .select('event_type event_date event_description order_summary')
        .sort({ event_date: -1 })
        .lean();

      const anonymized = caseDoc.toAnonymized();

      return res.json({
        success: true,
        data: {
          case: anonymized,
          timeline: publicEvents,
          disclosure_info: {
            mode: caseDoc.disclosure_mode,
            disclosed_fields: caseDoc.disclosure_mode !== 'private' ? caseDoc.disclosed_fields : [],
          },
        },
      });
    }

    // Victims can only see their own cases
    if (isCaseOwnerRole(role) && caseDoc.victim_user?._id.toString() !== req.user._id.toString()) {
      throw new AppError('Access denied. You can only view your own cases.', 403);
    }

    // Get full timeline events (authenticated users)
    const events = await CaseEvent.find({ case: caseDoc._id })
      .sort({ event_date: -1 })
      .lean();

    res.json({
      success: true,
      data: {
        case: caseDoc,
        timeline: events,
        computed: {
          days_pending: caseDoc.days_pending,
          masked_id: caseDoc.masked_id,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/cases — Create new case
// ============================================================
router.post('/', authenticate, denyVisitor, requireVerification('otp_verified'), validate(createCaseSchema), async (req, res, next) => {
  try {
    const {
      cnr_number, case_number, case_type, case_title,
      court_id, filing_date, accused_id, victim_id, judge_id, accused_name, judge_name,
      advocate_name, advocate_contact, victim_statement,
    } = req.body;

    // Validate court exists
    const court = await Court.findById(court_id);
    if (!court) {
      throw new AppError('Court not found', 404);
    }

    // Check duplicate CNR
    const existing = await Case.findOne({ cnr_number });
    if (existing) {
      throw new AppError('A case with this CNR number already exists', 409);
    }

    // Create case
    const newCase = await Case.create({
      cnr_number,
      case_number,
      case_type,
      case_title: case_title || `${case_type.replace(/_/g, ' ')} case`,
      court: court_id,
      victim_user: isCaseOwnerRole(req.user.role) ? req.user._id : null,
      victim_id: isCaseOwnerRole(req.user.role) ? req.user._id.toString() : (victim_id || null),
      filing_date: new Date(filing_date),
      accused_id,
      judge_id,
      accused_name,
      judge_name,
      advocate_name,
      advocate_contact,
      victim_statement,
    });

    // Create initial filing event
    await CaseEvent.create({
      case: newCase._id,
      event_type: 'filing',
      event_date: new Date(filing_date),
      event_description: `Case filed: ${newCase.case_title}`,
      is_public: true,
      created_by: req.user._id,
    });

    // Update court stats
    await Court.findByIdAndUpdate(court_id, { $inc: { total_cases_filed: 1 } });

    // ── Redis Cache Sync ──
    await syncCaseToRedis(newCase);
    await syncCourtStatsToRedis(court_id);

    // Populate for response
    const populated = await Case.findById(newCase._id)
      .populate('court', 'court_name district state');

    logger.info(`📋 Case created: ${cnr_number} by ${req.user.email}`);

    res.status(201).json({
      success: true,
      message: 'Case created successfully',
      data: { case: populated },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PUT /api/cases/:id — Update case
// ============================================================
router.put('/:id', authenticate, denyVisitor, validate(updateCaseSchema), async (req, res, next) => {
  try {
    const caseDoc = await Case.findById(req.params.id);
    if (!caseDoc) {
      throw new AppError('Case not found', 404);
    }

    // Only owner, admin, or court_staff can update
    const role = normalizeRole(req.user.role);
    if (isCaseOwnerRole(role) && caseDoc.victim_user?.toString() !== req.user._id.toString()) {
      throw new AppError('Access denied. You can only update your own cases.', 403);
    }
    if (!['admin', 'court_staff', 'user', 'advocate'].includes(role)) {
      throw new AppError('Access denied.', 403);
    }

    // Case owners can only update certain fields
    const ownerAllowedFields = ['case_title', 'advocate_name', 'advocate_contact', 'disclosure_mode', 'disclosed_fields'];
    if (isCaseOwnerRole(role)) {
      const updateKeys = Object.keys(req.body);
      const disallowed = updateKeys.filter(k => !ownerAllowedFields.includes(k));
      if (disallowed.length > 0) {
        throw new AppError(`Case owners cannot update: ${disallowed.join(', ')}`, 403);
      }
    }

    // Save old values for audit
    const oldValues = caseDoc.toObject();

    // Apply updates
    Object.assign(caseDoc, req.body);
    caseDoc.last_update = new Date();
    await caseDoc.save();

    // ── Redis Cache Sync ──
    await syncCaseToRedis(caseDoc);

    // ── Emit Real-Time Event ──
    try {
      await emitCaseEvent({
        caseId: caseDoc._id,
        type: 'STATUS_UPDATE',
        message: `Case ${caseDoc.cnr_number} updated`,
        createdBy: req.user._id,
        metadata: {
          caseNumber: caseDoc.cnr_number,
          caseTitle: caseDoc.case_title,
          updatedFields: Object.keys(req.body),
        },
        rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'user', 'victim'],
        usersVisibleTo: caseDoc.victim_user ? [caseDoc.victim_user] : [],
      });
    } catch (eventErr) {
      logger.warn(`Failed to emit case update event: ${eventErr.message}`);
    }

    // Audit
    await createAuditEntry({
      userId: req.user._id,
      action: 'case.update',
      entityType: 'case',
      entityId: caseDoc._id,
      oldValue: { status: oldValues.current_status, disclosure: oldValues.disclosure_mode },
      newValue: req.body,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const updated = await Case.findById(caseDoc._id)
      .populate('court', 'court_name district state');

    logger.info(`📝 Case updated: ${caseDoc.cnr_number} by ${req.user.email}`);

    res.json({
      success: true,
      message: 'Case updated successfully',
      data: { case: updated },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/cases/:id/status — Update case status (staff/admin)
// ============================================================
router.patch('/:id/status', authenticate, authorize('admin', 'court_staff'), async (req, res, next) => {
  try {
    const { status, next_hearing_date } = req.body;

    if (!status) {
      throw new AppError('Status is required', 400);
    }

    const validStatuses = ['filed', 'hearing', 'evidence', 'arguments', 'reserved', 'judgment', 'disposed', 'appealed'];
    if (!validStatuses.includes(status)) {
      throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400);
    }

    const caseDoc = await Case.findById(req.params.id);
    if (!caseDoc) {
      throw new AppError('Case not found', 404);
    }

    const oldStatus = caseDoc.current_status;
    caseDoc.current_status = status;
    caseDoc.last_update = new Date();
    if (next_hearing_date) caseDoc.next_hearing_date = new Date(next_hearing_date);
    if (status === 'disposed') caseDoc.next_hearing_date = null;
    await caseDoc.save();

    // Create status change event
    await CaseEvent.create({
      case: caseDoc._id,
      event_type: status === 'judgment' ? 'judgment' : 'order',
      event_date: new Date(),
      event_description: `Case status changed: ${oldStatus} → ${status}`,
      is_public: true,
      created_by: req.user._id,
    });

    // Update court stats if disposed
    if (status === 'disposed') {
      await Court.findByIdAndUpdate(caseDoc.court, { $inc: { total_cases_resolved: 1 } });
    }

    // ── Redis Cache Sync ──
    await syncCaseToRedis(caseDoc);
    await syncCourtStatsToRedis(caseDoc.court);

    // ── Emit Real-Time Event ──
    try {
      await emitCaseEvent({
        caseId: caseDoc._id,
        type: 'STATUS_UPDATE',
        message: `Case ${caseDoc.cnr_number} status changed from ${oldStatus} to ${status}`,
        createdBy: req.user._id,
        metadata: {
          caseNumber: caseDoc.cnr_number,
          caseTitle: caseDoc.case_title,
          oldValue: oldStatus,
          newValue: status,
        },
        rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'user', 'victim'],
        usersVisibleTo: caseDoc.victim_user ? [caseDoc.victim_user] : [],
      });
    } catch (eventErr) {
      logger.warn(`Failed to emit status update event: ${eventErr.message}`);
    }

    logger.info(`🔄 Case ${caseDoc.cnr_number}: ${oldStatus} → ${status} by ${req.user.email}`);

    res.json({
      success: true,
      message: `Case status updated to "${status}"`,
      data: {
        case_id: caseDoc._id,
        cnr_number: caseDoc.cnr_number,
        old_status: oldStatus,
        new_status: status,
        next_hearing_date: caseDoc.next_hearing_date,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// DELETE /api/cases/:id — Soft delete (admin only)
// ============================================================
router.delete('/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const caseDoc = await Case.findById(req.params.id);
    if (!caseDoc) {
      throw new AppError('Case not found', 404);
    }

    // Soft delete — mark as disposed
    caseDoc.current_status = 'disposed';
    caseDoc.last_update = new Date();
    await caseDoc.save();

    // ── Redis Cache Sync ──
    await deleteCaseCache(caseDoc._id);
    await syncCourtStatsToRedis(caseDoc.court);

    await createAuditEntry({
      userId: req.user._id,
      action: 'case.delete',
      entityType: 'case',
      entityId: caseDoc._id,
      oldValue: { cnr_number: caseDoc.cnr_number, case_title: caseDoc.case_title },
      ipAddress: req.ip,
    });

    logger.info(`🗑️ Case soft-deleted: ${caseDoc.cnr_number} by ${req.user.email}`);

    res.json({
      success: true,
      message: 'Case deleted (soft delete)',
      data: { case_id: caseDoc._id, cnr_number: caseDoc.cnr_number },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/cases/:id/events — Get case timeline
// ============================================================
// Uses optionalAuth: visitors/public see only public events.
// Authenticated owners/admin see all events.
// ============================================================
router.get('/:id/events', optionalAuth, async (req, res, next) => {
  try {
    const caseDoc = await Case.findById(req.params.id);
    if (!caseDoc) throw new AppError('Case not found', 404);

    const role = req.user ? normalizeRole(req.user.role) : 'visitor';
    const isPublicView = (role === 'visitor');

    // Build filter
    let filter = { case: caseDoc._id };

    // Visitors / unauthenticated → only public events
    if (isPublicView) {
      filter.is_public = true;
    }

    const selectFields = isPublicView
      ? 'event_type event_date event_description order_summary is_public'
      : undefined;

    const events = await CaseEvent.find(filter)
      .select(selectFields)
      .populate(isPublicView ? '' : 'created_by', isPublicView ? undefined : 'full_name role')
      .sort({ event_date: -1 })
      .lean();

    // For public view, don't expose cnr_number
    const responseId = isPublicView ? caseDoc.masked_id : caseDoc._id;
    const responseCnr = isPublicView ? undefined : caseDoc.cnr_number;

    res.json({
      success: true,
      data: {
        case_id: responseId,
        ...(responseCnr && { cnr_number: responseCnr }),
        total_events: events.length,
        events,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/cases/:id/events — Add event to timeline
// ============================================================
// Validates timeline consistency before adding the event.
// Auto-updates case counters, last_update, next_hearing_date,
// and case status based on event type.
// ============================================================
router.post('/:id/events', authenticate, denyVisitor, validate(addEventSchema), async (req, res, next) => {
  try {
    const caseDoc = await Case.findById(req.params.id);
    if (!caseDoc) throw new AppError('Case not found', 404);

    // Only owner, admin, court_staff can add events
    const role = normalizeRole(req.user.role);
    if (isCaseOwnerRole(role) && caseDoc.victim_user?.toString() !== req.user._id.toString()) {
      throw new AppError('Access denied. You can only add events to your own cases.', 403);
    }

    const { event_type, event_date, event_description, adjournment_reason, order_summary, is_public } = req.body;

    // ── Timeline Validation ──
    const { validateTimelineEvent } = require('../utils/timelineValidator');
    const validation = await validateTimelineEvent(caseDoc, {
      event_type,
      event_date,
      adjournment_reason,
    });

    if (!validation.valid) {
      throw new AppError(
        `Timeline validation failed: ${validation.errors.join(' | ')}`,
        400
      );
    }

    // ── Create Event ──
    const event = await CaseEvent.create({
      case: caseDoc._id,
      event_type,
      event_date: new Date(event_date),
      event_description,
      adjournment_reason,
      order_summary,
      is_public,
      created_by: req.user._id,
    });

    // ── Update Case Counters & State ──
    // Always update last_update on any event
    caseDoc.last_update = new Date();

    if (event_type === 'hearing') {
      caseDoc.total_hearings += 1;
      // If case is still 'filed', move to 'hearing' stage
      if (caseDoc.current_status === 'filed') {
        caseDoc.current_status = 'hearing';
      }
    }

    if (event_type === 'adjournment') {
      caseDoc.adjournment_count += 1;
      // Recalculate risk score (heuristic: each adjournment adds 0.5)
      caseDoc.delay_risk_score = Math.min(10, caseDoc.adjournment_count * 0.5);
      if (caseDoc.adjournment_count >= 10) caseDoc.stagnation_flag = true;
    }

    if (event_type === 'evidence_submitted') {
      if (['filed', 'hearing'].includes(caseDoc.current_status)) {
        caseDoc.current_status = 'evidence';
      }
    }

    if (event_type === 'argument') {
      if (['filed', 'hearing', 'evidence'].includes(caseDoc.current_status)) {
        caseDoc.current_status = 'arguments';
      }
    }

    if (event_type === 'judgment') {
      caseDoc.current_status = 'judgment';
      caseDoc.next_hearing_date = null; // No more hearings after judgment
      // Update court resolved count
      await Court.findByIdAndUpdate(caseDoc.court, { $inc: { total_cases_resolved: 1 } });
    }

    // ── Auto-update next_hearing_date ──
    // If a hearing or adjournment event is added, check if there's a
    // next_hearing_date in the description or set from request body
    if (['hearing', 'adjournment'].includes(event_type)) {
      // If the event_date is in the future relative to now, treat it as next hearing
      const eventDateObj = new Date(event_date);
      if (eventDateObj > new Date()) {
        caseDoc.next_hearing_date = eventDateObj;
      }
    }

    await caseDoc.save();

    // ── Redis Cache Sync ──
    await syncCaseToRedis(caseDoc);

    // ── Emit Real-Time Event ──
    const eventTypeMap = {
      'adjournment': 'ADJOURNMENT',
      'hearing': 'HEARING_STARTED',
      'judgment': 'JUDGMENT',
      'document_uploaded': 'DOCUMENT_UPLOADED',
      'order': 'STATUS_UPDATE',
      'other': 'OTHER',
    };

    const mappedEventType = eventTypeMap[event_type] || 'OTHER';

    try {
      await emitCaseEvent({
        caseId: caseDoc._id,
        type: mappedEventType,
        message: event_description || `${event_type} event added to case ${caseDoc.cnr_number}`,
        createdBy: req.user._id,
        metadata: {
          caseNumber: caseDoc.cnr_number,
          caseTitle: caseDoc.case_title,
          eventType: event_type,
          adjournmentReason: adjournment_reason,
          orderSummary: order_summary,
        },
        rolesVisibleTo: is_public ? ['admin', 'court_staff', 'advocate', 'user', 'victim', 'visitor'] : ['admin', 'court_staff', 'advocate', 'user', 'victim'],
        usersVisibleTo: caseDoc.victim_user ? [caseDoc.victim_user] : [],
      });
    } catch (eventErr) {
      logger.warn(`Failed to emit case event: ${eventErr.message}`);
    }

    logger.info(`📌 Event added to ${caseDoc.cnr_number}: ${event_type} by ${req.user.email}`);

    res.status(201).json({
      success: true,
      message: 'Event added to case timeline',
      data: {
        event,
        case_updates: {
          current_status: caseDoc.current_status,
          adjournment_count: caseDoc.adjournment_count,
          total_hearings: caseDoc.total_hearings,
          delay_risk_score: caseDoc.delay_risk_score,
          next_hearing_date: caseDoc.next_hearing_date,
          stagnation_flag: caseDoc.stagnation_flag,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/cases/:id/timeline-audit — Audit timeline consistency
// ============================================================
// Returns warnings about any inconsistencies in the case timeline.
// Useful for admin/staff to verify data quality.
// ============================================================
router.get('/:id/timeline-audit', authenticate, authorize('admin', 'court_staff'), async (req, res, next) => {
  try {
    const caseDoc = await Case.findById(req.params.id);
    if (!caseDoc) throw new AppError('Case not found', 404);

    const { auditTimeline } = require('../utils/timelineValidator');
    const audit = await auditTimeline(caseDoc._id);

    // Also check adjournment count vs actual adjournment events
    const actualAdj = await CaseEvent.countDocuments({
      case: caseDoc._id,
      event_type: 'adjournment',
    });
    if (actualAdj !== caseDoc.adjournment_count) {
      audit.warnings.push(
        `Adjournment count mismatch: case says ${caseDoc.adjournment_count}, but ${actualAdj} adjournment events found.`
      );
      audit.valid = false;
    }

    // Check hearing count
    const actualHearings = await CaseEvent.countDocuments({
      case: caseDoc._id,
      event_type: 'hearing',
    });
    if (actualHearings !== caseDoc.total_hearings) {
      audit.warnings.push(
        `Hearing count mismatch: case says ${caseDoc.total_hearings}, but ${actualHearings} hearing events found.`
      );
      audit.valid = false;
    }

    res.json({
      success: true,
      data: {
        case_id: caseDoc._id,
        cnr_number: caseDoc.cnr_number,
        timeline_consistent: audit.valid,
        warnings: audit.warnings,
        counts: {
          adjournment_count: caseDoc.adjournment_count,
          actual_adjournment_events: actualAdj,
          total_hearings: caseDoc.total_hearings,
          actual_hearing_events: actualHearings,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
