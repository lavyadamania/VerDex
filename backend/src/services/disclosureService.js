// ============================================================
// Victim-Controlled Disclosure Service
// ============================================================
// Handles disclosure request lifecycle:
//   1. Submit disclosure request (victim selects fields)
//   2. AI safety check (simulated — checks for re-identification risk)
//   3. Admin review (approve/reject with notes)
//   4. On approval: update case disclosure_mode + disclosed_fields
//   5. Revoke disclosure (victim takes back)
//   6. Audit trail for all disclosure actions
// ============================================================
const Case = require('../models/Case');
const DisclosureRequest = require('../models/DisclosureRequest');
const { createAuditEntry } = require('../middleware/audit');
const logger = require('../utils/logger');
const { publishToUser } = require('./eventPublisher');

// Fields that CAN be disclosed (whitelist)
const DISCLOSABLE_FIELDS = [
  'accused_name',
  'judge_name',
  'advocate_name',
  'victim_statement',
  'timeline',
];

// High-risk fields that trigger safety warnings
const HIGH_RISK_FIELDS = ['victim_statement'];

// ============================================================
// AI Safety Check (Simulated)
// ============================================================
// In production, this would call Google Gemini to analyze
// whether disclosing certain fields could identify the victim.
// For now, we use rule-based heuristics.
// ============================================================

/**
 * Perform a safety check on requested disclosure fields.
 *
 * @param {Object} caseDoc - The case document
 * @param {string[]} requestedFields - Fields the victim wants to disclose
 * @returns {Object} { passed, riskLevel, notes, warnings }
 */
function performSafetyCheck(caseDoc, requestedFields) {
  const warnings = [];
  let riskLevel = 'low';

  // Check for high-risk fields
  const highRiskRequested = requestedFields.filter(f => HIGH_RISK_FIELDS.includes(f));
  if (highRiskRequested.length > 0) {
    warnings.push(`High-risk fields requested: ${highRiskRequested.join(', ')}. Victim statement may contain identifying information.`);
    riskLevel = 'high';
  }

  // Check if disclosing multiple fields together increases risk
  if (requestedFields.includes('accused_name') && requestedFields.includes('judge_name')) {
    warnings.push('Disclosing both accused and judge names together may narrow identification.');
    if (riskLevel === 'low') riskLevel = 'medium';
  }

  // Check sensitive case types
  const sensitiveCaseTypes = ['sexual_assault', 'domestic_violence'];
  if (sensitiveCaseTypes.includes(caseDoc.case_type)) {
    warnings.push(`Case type "${caseDoc.case_type}" is sensitive. Extra caution is advised for any disclosure.`);
    if (riskLevel === 'low') riskLevel = 'medium';
  }

  // Determine if safety check passes
  // High risk doesn't auto-fail — it flags for admin attention
  const passed = riskLevel !== 'high';

  const notes = warnings.length > 0
    ? `Safety check: ${riskLevel} risk. ${warnings.join(' ')}`
    : 'Safety check: low risk. No concerns detected.';

  return { passed, riskLevel, notes, warnings };
}

// ============================================================
// Submit Disclosure Request
// ============================================================

/**
 * Submit a new disclosure request for a case.
 *
 * @param {Object} params
 * @param {string} params.caseId - Case ID
 * @param {string} params.userId - Requesting user ID
 * @param {string[]} params.requestedFields - Fields to disclose
 * @param {string} params.justification - Why disclosure is requested
 * @param {Object} params.auditInfo - { ipAddress, userAgent }
 * @returns {Object} Created disclosure request
 */
async function submitDisclosureRequest({ caseId, userId, requestedFields, justification, auditInfo = {} }) {
  // Validate case exists and user owns it
  const caseDoc = await Case.findById(caseId);
  if (!caseDoc) throw new Error('Case not found');

  if (caseDoc.victim_user?.toString() !== userId.toString()) {
    throw new Error('Only the case owner can submit a disclosure request');
  }

  // Validate requested fields
  const invalidFields = requestedFields.filter(f => !DISCLOSABLE_FIELDS.includes(f));
  if (invalidFields.length > 0) {
    throw new Error(`Invalid disclosure fields: ${invalidFields.join(', ')}. Allowed: ${DISCLOSABLE_FIELDS.join(', ')}`);
  }

  if (requestedFields.length === 0) {
    throw new Error('At least one field must be selected for disclosure');
  }

  // Check for existing pending request
  const existingPending = await DisclosureRequest.findOne({
    case: caseId,
    requested_by: userId,
    status: 'pending',
  });

  if (existingPending) {
    throw new Error('You already have a pending disclosure request for this case. Wait for review or cancel it first.');
  }

  // Run safety check
  const safetyResult = performSafetyCheck(caseDoc, requestedFields);

  // Create disclosure request
  const request = await DisclosureRequest.create({
    case: caseId,
    requested_by: userId,
    requested_fields: requestedFields,
    justification: justification || '',
    status: 'pending',
    safety_check_passed: safetyResult.passed,
    safety_check_notes: safetyResult.notes,
  });

  // Audit log
  await createAuditEntry({
    userId,
    action: 'disclosure.submit',
    entityType: 'disclosure_request',
    entityId: request._id,
    newValue: {
      case_id: caseId,
      requested_fields: requestedFields,
      safety_check: safetyResult,
    },
    ipAddress: auditInfo.ipAddress,
    userAgent: auditInfo.userAgent,
  });

  logger.info(`📋 Disclosure request submitted for case ${caseDoc.cnr_number} by user ${userId}`);

  return {
    request,
    safetyCheck: safetyResult,
  };
}

// ============================================================
// Admin Review (Approve / Reject)
// ============================================================

/**
 * Admin reviews a disclosure request.
 *
 * @param {Object} params
 * @param {string} params.requestId - Disclosure request ID
 * @param {string} params.adminId - Admin user ID
 * @param {string} params.decision - 'approved' or 'rejected'
 * @param {string} params.notes - Admin review notes
 * @param {Object} params.auditInfo
 * @returns {Object} Updated request + case state
 */
async function reviewDisclosureRequest({ requestId, adminId, decision, notes, auditInfo = {} }) {
  if (!['approved', 'rejected'].includes(decision)) {
    throw new Error('Decision must be "approved" or "rejected"');
  }

  const request = await DisclosureRequest.findById(requestId);
  if (!request) throw new Error('Disclosure request not found');

  if (request.status !== 'pending') {
    throw new Error(`Request is already ${request.status}. Only pending requests can be reviewed.`);
  }

  const oldStatus = request.status;
  request.status = decision;
  request.reviewed_by = adminId;
  request.reviewed_at = new Date();
  if (notes) {
    request.safety_check_notes = (request.safety_check_notes || '') + ` | Admin: ${notes}`;
  }
  await request.save();

  let caseUpdated = false;

  // On approval: update case disclosure settings
  if (decision === 'approved') {
    const caseDoc = await Case.findById(request.case);
    if (caseDoc) {
      // Merge new disclosed fields with existing
      const existingFields = caseDoc.disclosed_fields || [];
      const merged = [...new Set([...existingFields, ...request.requested_fields])];

      caseDoc.disclosed_fields = merged;
      caseDoc.disclosure_mode = merged.length > 0 ? 'partial' : 'private';
      await caseDoc.save();
      caseUpdated = true;

      logger.info(`✅ Disclosure approved for case ${caseDoc.cnr_number}: ${merged.join(', ')}`);
    }
  } else {
    logger.info(`❌ Disclosure rejected for request ${requestId}`);
  }

  // Audit log
  await createAuditEntry({
    userId: adminId,
    action: `disclosure.${decision}`,
    entityType: 'disclosure_request',
    entityId: request._id,
    oldValue: { status: oldStatus },
    newValue: { status: decision, notes, caseUpdated },
    ipAddress: auditInfo.ipAddress,
    userAgent: auditInfo.userAgent,
  });

  // ── Publish real-time disclosure update via Pub/Sub ──
  publishToUser(request.requested_by, 'disclosure_update', {
    requestId: request._id,
    decision,
    caseId: request.case,
    notes: notes || '',
  }).catch(() => {}); // Fire-and-forget

  return { request, caseUpdated };
}

// ============================================================
// Revoke Disclosure
// ============================================================

/**
 * Victim revokes a disclosure (takes back previously approved fields).
 *
 * @param {Object} params
 * @param {string} params.requestId - Disclosure request ID (or caseId)
 * @param {string} params.userId - Victim user ID
 * @param {Object} params.auditInfo
 * @returns {Object} Updated state
 */
async function revokeDisclosure({ requestId, userId, auditInfo = {} }) {
  const request = await DisclosureRequest.findById(requestId);
  if (!request) throw new Error('Disclosure request not found');

  if (request.requested_by.toString() !== userId.toString()) {
    throw new Error('Only the requester can revoke a disclosure');
  }

  if (request.status !== 'approved') {
    throw new Error(`Can only revoke approved disclosures. Current status: ${request.status}`);
  }

  // Mark request as revoked
  request.status = 'revoked';
  await request.save();

  // Remove the disclosed fields from the case
  const caseDoc = await Case.findById(request.case);
  if (caseDoc) {
    const fieldsToRemove = request.requested_fields;
    caseDoc.disclosed_fields = (caseDoc.disclosed_fields || []).filter(
      f => !fieldsToRemove.includes(f)
    );

    // Update disclosure mode
    if (caseDoc.disclosed_fields.length === 0) {
      caseDoc.disclosure_mode = 'private';
    }

    await caseDoc.save();

    logger.info(`🔒 Disclosure revoked for case ${caseDoc.cnr_number}: removed ${fieldsToRemove.join(', ')}`);
  }

  // Audit log
  await createAuditEntry({
    userId,
    action: 'disclosure.revoke',
    entityType: 'disclosure_request',
    entityId: request._id,
    oldValue: { status: 'approved' },
    newValue: { status: 'revoked', removed_fields: request.requested_fields },
    ipAddress: auditInfo.ipAddress,
    userAgent: auditInfo.userAgent,
  });

  // ── Publish real-time revoke event via Pub/Sub ──
  publishToUser(userId, 'disclosure_update', {
    requestId: request._id,
    action: 'revoked',
    caseId: request.case,
    removedFields: request.requested_fields,
  }).catch(() => {}); // Fire-and-forget

  return {
    request,
    caseDisclosureMode: caseDoc?.disclosure_mode || 'unknown',
    remainingFields: caseDoc?.disclosed_fields || [],
  };
}

// ============================================================
// Get Disclosure History for a Case
// ============================================================

/**
 * Get all disclosure requests for a case.
 *
 * @param {string} caseId
 * @returns {Array} List of disclosure requests
 */
async function getDisclosureHistory(caseId) {
  return DisclosureRequest.find({ case: caseId })
    .populate('requested_by', 'full_name email')
    .populate('reviewed_by', 'full_name email')
    .sort({ createdAt: -1 })
    .lean();
}

module.exports = {
  DISCLOSABLE_FIELDS,
  performSafetyCheck,
  submitDisclosureRequest,
  reviewDisclosureRequest,
  revokeDisclosure,
  getDisclosureHistory,
};
