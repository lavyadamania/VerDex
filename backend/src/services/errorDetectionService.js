// ============================================================
// Error Detection Service — Stage 17
// ============================================================
// Centralized service for detecting data inconsistencies,
// invalid date sequences, impossible timelines, and
// status/counter mismatches in case records.
//
// Each check returns an array of error objects:
//   { code, severity, title, message }
//
// After all checks run, errors are persisted as alerts.
// ============================================================
const Case = require('../models/Case');
const CaseEvent = require('../models/CaseEvent');
const Document = require('../models/Document');
const { createAlert } = require('./alertService');
const logger = require('../utils/logger');

// ── Error Codes ──
const ERROR_CODES = {
  DATE_BEFORE_FILING: 'ERR_DATE_BEFORE_FILING',
  FUTURE_HEARING_DISPOSED: 'ERR_FUTURE_HEARING_DISPOSED',
  PAST_NEXT_HEARING: 'ERR_PAST_NEXT_HEARING',
  HEARING_AFTER_JUDGMENT: 'ERR_HEARING_AFTER_JUDGMENT',
  STATUS_NO_JUDGMENT_EVENT: 'ERR_STATUS_NO_JUDGMENT_EVENT',
  STATUS_FILED_HAS_HEARINGS: 'ERR_STATUS_FILED_HAS_HEARINGS',
  ADJOURNMENT_COUNT_MISMATCH: 'ERR_ADJOURNMENT_COUNT_MISMATCH',
  HEARING_COUNT_MISMATCH: 'ERR_HEARING_COUNT_MISMATCH',
  DUPLICATE_EVENTS_SAME_DAY: 'ERR_DUPLICATE_EVENTS_SAME_DAY',
  EVENTS_BEFORE_FILING: 'ERR_EVENTS_BEFORE_FILING',
  DOC_TYPE_STATUS_MISMATCH: 'ERR_DOC_TYPE_STATUS_MISMATCH',
  MISSING_CRITICAL_DOCUMENT: 'ERR_MISSING_CRITICAL_DOCUMENT',
  LONG_PENDING_UNVERIFIED: 'ERR_LONG_PENDING_UNVERIFIED',
  FILING_DATE_FUTURE: 'ERR_FILING_DATE_FUTURE',
  STALE_CASE_NO_EVENTS: 'ERR_STALE_CASE_NO_EVENTS',
};

// ============================================================
// Check 1: Invalid Date Sequences
// ============================================================
async function checkDateSequences(caseDoc) {
  const errors = [];
  const filingDate = new Date(caseDoc.filing_date);
  const now = new Date();

  // 1a. Filing date in the future
  if (filingDate > now) {
    errors.push({
      code: ERROR_CODES.FILING_DATE_FUTURE,
      severity: 'high',
      title: `Filing date is in the future — ${caseDoc.cnr_number}`,
      message: `Case ${caseDoc.cnr_number} has a filing date of ${filingDate.toISOString().split('T')[0]}, which is in the future. This is likely a data entry error.`,
    });
  }

  // 1b. Next hearing date is in the past for active cases
  if (
    caseDoc.next_hearing_date &&
    !['disposed', 'judgment'].includes(caseDoc.current_status)
  ) {
    const nextHearing = new Date(caseDoc.next_hearing_date);
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    if (nextHearing < threeDaysAgo) {
      errors.push({
        code: ERROR_CODES.PAST_NEXT_HEARING,
        severity: 'medium',
        title: `Next hearing date is in the past — ${caseDoc.cnr_number}`,
        message: `Case ${caseDoc.cnr_number} has next_hearing_date set to ${nextHearing.toISOString().split('T')[0]}, which is more than 3 days in the past. The hearing date should be updated.`,
      });
    }
  }

  // 1c. Case disposed/judgment but still has a future next_hearing_date
  if (
    ['disposed', 'judgment'].includes(caseDoc.current_status) &&
    caseDoc.next_hearing_date
  ) {
    const nextHearing = new Date(caseDoc.next_hearing_date);
    if (nextHearing > now) {
      errors.push({
        code: ERROR_CODES.FUTURE_HEARING_DISPOSED,
        severity: 'high',
        title: `Disposed case has future hearing — ${caseDoc.cnr_number}`,
        message: `Case ${caseDoc.cnr_number} is marked as "${caseDoc.current_status}" but has a future hearing date (${nextHearing.toISOString().split('T')[0]}). This is contradictory.`,
      });
    }
  }

  return errors;
}

// ============================================================
// Check 2: Impossible Timeline Detection
// ============================================================
async function checkImpossibleTimeline(caseDoc) {
  const errors = [];
  const filingDate = new Date(caseDoc.filing_date);

  // Fetch all events sorted by date
  const events = await CaseEvent.find({ case: caseDoc._id })
    .sort({ event_date: 1 })
    .lean();

  if (events.length === 0 && caseDoc.current_status !== 'filed') {
    errors.push({
      code: ERROR_CODES.STALE_CASE_NO_EVENTS,
      severity: 'medium',
      title: `No events but status is "${caseDoc.current_status}" — ${caseDoc.cnr_number}`,
      message: `Case ${caseDoc.cnr_number} has status "${caseDoc.current_status}" but no timeline events exist (not even a filing event). This indicates missing data.`,
    });
    return errors;
  }

  // 2a. Events before filing date
  const eventsBeforeFiling = events.filter(
    (e) => new Date(e.event_date) < filingDate && e.event_type !== 'filing'
  );
  if (eventsBeforeFiling.length > 0) {
    errors.push({
      code: ERROR_CODES.EVENTS_BEFORE_FILING,
      severity: 'high',
      title: `Events exist before filing date — ${caseDoc.cnr_number}`,
      message: `Case ${caseDoc.cnr_number} has ${eventsBeforeFiling.length} event(s) dated before the filing date (${filingDate.toISOString().split('T')[0]}). Events: ${eventsBeforeFiling.map((e) => `${e.event_type} on ${new Date(e.event_date).toISOString().split('T')[0]}`).join(', ')}.`,
    });
  }

  // 2b. Hearing events after a judgment event
  let judgmentDate = null;
  for (const event of events) {
    if (event.event_type === 'judgment') {
      judgmentDate = new Date(event.event_date);
    } else if (
      judgmentDate &&
      event.event_type === 'hearing' &&
      new Date(event.event_date) > judgmentDate
    ) {
      errors.push({
        code: ERROR_CODES.HEARING_AFTER_JUDGMENT,
        severity: 'high',
        title: `Hearing after judgment — ${caseDoc.cnr_number}`,
        message: `Case ${caseDoc.cnr_number} has a hearing on ${new Date(event.event_date).toISOString().split('T')[0]} that occurs after the judgment on ${judgmentDate.toISOString().split('T')[0]}. Unless this is an appeal, this is an error.`,
      });
      break; // Report once
    }
  }

  // 2c. Duplicate events on the same day with same type
  const eventDayMap = {};
  for (const event of events) {
    const dayKey = `${event.event_type}_${new Date(event.event_date).toISOString().split('T')[0]}`;
    if (eventDayMap[dayKey]) {
      errors.push({
        code: ERROR_CODES.DUPLICATE_EVENTS_SAME_DAY,
        severity: 'low',
        title: `Duplicate "${event.event_type}" event — ${caseDoc.cnr_number}`,
        message: `Case ${caseDoc.cnr_number} has multiple "${event.event_type}" events on ${new Date(event.event_date).toISOString().split('T')[0]}.`,
      });
      break; // Report once
    }
    eventDayMap[dayKey] = true;
  }

  return errors;
}

// ============================================================
// Check 3: Status vs Timeline Mismatch
// ============================================================
async function checkStatusMismatch(caseDoc) {
  const errors = [];

  const events = await CaseEvent.find({ case: caseDoc._id }).lean();
  const eventTypes = events.map((e) => e.event_type);

  // 3a. Status is "judgment" but no judgment event exists
  if (
    caseDoc.current_status === 'judgment' &&
    !eventTypes.includes('judgment')
  ) {
    errors.push({
      code: ERROR_CODES.STATUS_NO_JUDGMENT_EVENT,
      severity: 'high',
      title: `Status "judgment" but no judgment event — ${caseDoc.cnr_number}`,
      message: `Case ${caseDoc.cnr_number} has status "judgment" but there is no judgment event in the timeline. A judgment event should be recorded.`,
    });
  }

  // 3b. Status is "filed" but has hearing events
  if (
    caseDoc.current_status === 'filed' &&
    eventTypes.includes('hearing')
  ) {
    errors.push({
      code: ERROR_CODES.STATUS_FILED_HAS_HEARINGS,
      severity: 'medium',
      title: `Status "filed" but hearings exist — ${caseDoc.cnr_number}`,
      message: `Case ${caseDoc.cnr_number} has status "filed" but ${eventTypes.filter((t) => t === 'hearing').length} hearing event(s) exist. Status should be updated to at least "hearing".`,
    });
  }

  return errors;
}

// ============================================================
// Check 4: Counter Mismatch Detection
// ============================================================
async function checkCounterMismatch(caseDoc) {
  const errors = [];

  const [actualAdj, actualHearings] = await Promise.all([
    CaseEvent.countDocuments({ case: caseDoc._id, event_type: 'adjournment' }),
    CaseEvent.countDocuments({ case: caseDoc._id, event_type: 'hearing' }),
  ]);

  // 4a. Adjournment count mismatch
  if (actualAdj !== caseDoc.adjournment_count) {
    errors.push({
      code: ERROR_CODES.ADJOURNMENT_COUNT_MISMATCH,
      severity: 'medium',
      title: `Adjournment count mismatch — ${caseDoc.cnr_number}`,
      message: `Case ${caseDoc.cnr_number}: adjournment_count is ${caseDoc.adjournment_count} but ${actualAdj} adjournment events found. These should match.`,
    });
  }

  // 4b. Hearing count mismatch
  if (actualHearings !== caseDoc.total_hearings) {
    errors.push({
      code: ERROR_CODES.HEARING_COUNT_MISMATCH,
      severity: 'medium',
      title: `Hearing count mismatch — ${caseDoc.cnr_number}`,
      message: `Case ${caseDoc.cnr_number}: total_hearings is ${caseDoc.total_hearings} but ${actualHearings} hearing events found. These should match.`,
    });
  }

  return errors;
}

// ============================================================
// Check 5: Document-Input Mismatch Detection (Rule-Based)
// ============================================================
// Cross-checks documents against case status and flags
// inconsistencies. Pluggable — AI can be added later.
// ============================================================
async function checkDocumentMismatch(caseDoc) {
  const errors = [];
  const now = new Date();

  const documents = await Document.find({ case: caseDoc._id }).lean();

  if (documents.length === 0) {
    // No documents — nothing to cross-check
    return errors;
  }

  const docTypes = documents.map((d) => d.doc_type);
  const verifiedDocs = documents.filter((d) => d.verified_status === 'verified');
  const pendingDocs = documents.filter((d) => d.verified_status === 'pending');

  // 5a. Judgment document uploaded but case not in judgment/disposed status
  if (
    docTypes.includes('judgment') &&
    !['judgment', 'disposed', 'appealed'].includes(caseDoc.current_status)
  ) {
    errors.push({
      code: ERROR_CODES.DOC_TYPE_STATUS_MISMATCH,
      severity: 'medium',
      title: `Judgment document but case not in judgment — ${caseDoc.cnr_number}`,
      message: `Case ${caseDoc.cnr_number} has a judgment document uploaded, but the case status is "${caseDoc.current_status}". If a judgment has been passed, the status should be updated.`,
    });
  }

  // 5b. Chargesheet uploaded but case still in "filed" status
  if (
    docTypes.includes('chargesheet') &&
    caseDoc.current_status === 'filed'
  ) {
    errors.push({
      code: ERROR_CODES.DOC_TYPE_STATUS_MISMATCH,
      severity: 'low',
      title: `Chargesheet uploaded but case still "filed" — ${caseDoc.cnr_number}`,
      message: `Case ${caseDoc.cnr_number} has a chargesheet uploaded, but status is still "filed". The case should move to at least "hearing" stage.`,
    });
  }

  // 5c. Case in judgment/disposed but no judgment document
  if (
    ['judgment', 'disposed'].includes(caseDoc.current_status) &&
    !docTypes.includes('judgment')
  ) {
    errors.push({
      code: ERROR_CODES.MISSING_CRITICAL_DOCUMENT,
      severity: 'medium',
      title: `Case "${caseDoc.current_status}" but no judgment document — ${caseDoc.cnr_number}`,
      message: `Case ${caseDoc.cnr_number} is marked as "${caseDoc.current_status}" but no judgment document has been uploaded. A judgment copy should be uploaded for record.`,
    });
  }

  // 5d. Case has hearings but no FIR/court_order document
  if (
    caseDoc.total_hearings >= 3 &&
    !docTypes.includes('fir') &&
    !docTypes.includes('court_order')
  ) {
    errors.push({
      code: ERROR_CODES.MISSING_CRITICAL_DOCUMENT,
      severity: 'low',
      title: `Multiple hearings but no FIR/court order — ${caseDoc.cnr_number}`,
      message: `Case ${caseDoc.cnr_number} has ${caseDoc.total_hearings} hearings but no FIR or court order document uploaded. Consider uploading foundational documents.`,
    });
  }

  // 5e. Documents pending verification for more than 7 days
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const longPending = pendingDocs.filter(
    (d) => new Date(d.createdAt) < sevenDaysAgo
  );
  if (longPending.length > 0) {
    errors.push({
      code: ERROR_CODES.LONG_PENDING_UNVERIFIED,
      severity: 'low',
      title: `${longPending.length} document(s) pending verification > 7 days — ${caseDoc.cnr_number}`,
      message: `Case ${caseDoc.cnr_number} has ${longPending.length} document(s) that have been pending verification for over 7 days: ${longPending.map((d) => d.file_name).join(', ')}. Admin review is needed.`,
    });
  }

  return errors;
}

// ============================================================
// Run ALL checks on a single case
// ============================================================
/**
 * Scan a single case for all types of errors.
 *
 * @param {string} caseId - Case ObjectId
 * @param {Object} options
 * @param {boolean} options.generateAlerts - Whether to create alert records (default true)
 * @returns {{ caseId, cnr_number, errors: Array, alertsCreated: number }}
 */
async function scanCaseForErrors(caseId, { generateAlerts = true } = {}) {
  const caseDoc = await Case.findById(caseId);
  if (!caseDoc) {
    throw new Error(`Case not found: ${caseId}`);
  }

  // Run all checks in parallel
  const [dateErrors, timelineErrors, statusErrors, counterErrors, docErrors] =
    await Promise.all([
      checkDateSequences(caseDoc),
      checkImpossibleTimeline(caseDoc),
      checkStatusMismatch(caseDoc),
      checkCounterMismatch(caseDoc),
      checkDocumentMismatch(caseDoc),
    ]);

  const allErrors = [
    ...dateErrors,
    ...timelineErrors,
    ...statusErrors,
    ...counterErrors,
    ...docErrors,
  ];

  // Generate alerts for each error
  let alertsCreated = 0;
  if (generateAlerts && allErrors.length > 0) {
    for (const error of allErrors) {
      // Alert the case owner (victim) if they exist
      const recipientId = caseDoc.victim_user || null;
      if (recipientId) {
        const alert = await createAlert({
          caseId: caseDoc._id,
          userId: recipientId,
          alertType: 'error_detected',
          title: error.title,
          message: error.message,
          severity: error.severity,
          dedupHours: 48, // Don't re-alert for same error within 48h
        });
        if (alert) alertsCreated++;
      }
    }
  }

  logger.info(
    `🔍 Error scan: ${caseDoc.cnr_number} — ${allErrors.length} error(s) found, ${alertsCreated} alert(s) created`
  );

  return {
    caseId: caseDoc._id,
    cnr_number: caseDoc.cnr_number,
    errors: allErrors,
    alertsCreated,
  };
}

// ============================================================
// Scan ALL active cases (bulk operation)
// ============================================================
/**
 * Scan all active (non-disposed) cases for errors.
 *
 * @param {Object} options
 * @param {boolean} options.generateAlerts - Whether to create alerts (default true)
 * @returns {{ totalCasesScanned, totalErrors, totalAlerts, results: Array }}
 */
async function scanAllCasesForErrors({ generateAlerts = true } = {}) {
  const activeCases = await Case.find({
    current_status: { $nin: ['disposed'] },
  })
    .select('_id')
    .lean();

  logger.info(`🔍 Starting bulk error scan on ${activeCases.length} active cases...`);

  let totalErrors = 0;
  let totalAlerts = 0;
  const results = [];

  for (const c of activeCases) {
    try {
      const result = await scanCaseForErrors(c._id, { generateAlerts });
      if (result.errors.length > 0) {
        results.push(result);
        totalErrors += result.errors.length;
        totalAlerts += result.alertsCreated;
      }
    } catch (err) {
      logger.error({ err }, `Error scanning case ${c._id}`);
    }
  }

  logger.info(
    `🔍 Bulk scan complete: ${activeCases.length} cases scanned, ${totalErrors} errors, ${totalAlerts} alerts`
  );

  return {
    totalCasesScanned: activeCases.length,
    totalErrors,
    totalAlerts,
    casesWithErrors: results.length,
    results,
  };
}

// ============================================================
// Get error summary stats (no scanning, just count existing alerts)
// ============================================================
async function getErrorSummary() {
  const Alert = require('../models/Alert');

  const [totalErrorAlerts, unresolvedErrors, bySeverity] = await Promise.all([
    Alert.countDocuments({ alert_type: 'error_detected' }),
    Alert.countDocuments({ alert_type: 'error_detected', is_read: false, is_dismissed: { $ne: true } }),
    Alert.aggregate([
      { $match: { alert_type: 'error_detected' } },
      { $group: { _id: '$severity', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  return {
    total_error_alerts: totalErrorAlerts,
    unresolved_errors: unresolvedErrors,
    by_severity: bySeverity.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
  };
}

module.exports = {
  ERROR_CODES,
  checkDateSequences,
  checkImpossibleTimeline,
  checkStatusMismatch,
  checkCounterMismatch,
  checkDocumentMismatch,
  scanCaseForErrors,
  scanAllCasesForErrors,
  getErrorSummary,
};
