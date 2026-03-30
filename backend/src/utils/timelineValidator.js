// ============================================================
// Timeline Validation Utility
// ============================================================
// Validates case event dates to prevent impossible sequences.
//
// Rules enforced:
// 1. Event date cannot be before case filing_date
// 2. Event date cannot be more than 1 day in the future
// 3. Adjournment events must have adjournment_reason
// 4. Filing event date must match case filing_date
// 5. Judgment/disposal date cannot be before last hearing
// 6. Duplicate event detection (same type + same date)
// ============================================================
const CaseEvent = require('../models/CaseEvent');

/**
 * Validate a new event against the case and existing timeline.
 *
 * @param {Object} caseDoc - The parent case document
 * @param {Object} eventData - The new event to validate
 *   { event_type, event_date, adjournment_reason }
 * @returns {{ valid: boolean, errors: string[] }}
 */
async function validateTimelineEvent(caseDoc, eventData) {
  const errors = [];
  const eventDate = new Date(eventData.event_date);
  const filingDate = new Date(caseDoc.filing_date);
  const now = new Date();

  // ── Rule 1: Event date cannot be before filing date ──
  if (eventDate < filingDate) {
    const filingStr = filingDate.toISOString().split('T')[0];
    errors.push(
      `Event date (${eventDate.toISOString().split('T')[0]}) cannot be before case filing date (${filingStr}).`
    );
  }

  // ── Rule 2: Event date cannot be more than 1 day in the future ──
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 59, 999);

  if (eventDate > tomorrow) {
    errors.push(
      `Event date cannot be more than 1 day in the future. Received: ${eventDate.toISOString().split('T')[0]}.`
    );
  }

  // ── Rule 3: Adjournment must have a reason ──
  if (eventData.event_type === 'adjournment') {
    if (!eventData.adjournment_reason || eventData.adjournment_reason.trim() === '') {
      errors.push('Adjournment events must include an adjournment_reason.');
    }
  }

  // ── Rule 4: Filing event date should match case filing date ──
  if (eventData.event_type === 'filing') {
    const filingDayStr = filingDate.toISOString().split('T')[0];
    const eventDayStr = eventDate.toISOString().split('T')[0];
    if (filingDayStr !== eventDayStr) {
      errors.push(
        `Filing event date (${eventDayStr}) should match the case filing date (${filingDayStr}).`
      );
    }

    // Check if filing event already exists
    const existingFiling = await CaseEvent.findOne({
      case: caseDoc._id,
      event_type: 'filing',
    });
    if (existingFiling) {
      errors.push('A filing event already exists for this case. Only one filing event is allowed.');
    }
  }

  // ── Rule 5: Judgment cannot be before the last hearing ──
  if (eventData.event_type === 'judgment') {
    const lastHearing = await CaseEvent.findOne({
      case: caseDoc._id,
      event_type: { $in: ['hearing', 'argument'] },
    }).sort({ event_date: -1 });

    if (lastHearing && eventDate < new Date(lastHearing.event_date)) {
      errors.push(
        `Judgment date cannot be before the last hearing/argument (${new Date(lastHearing.event_date).toISOString().split('T')[0]}).`
      );
    }
  }

  // ── Rule 6: Duplicate event detection ──
  const eventDayStart = new Date(eventDate);
  eventDayStart.setHours(0, 0, 0, 0);
  const eventDayEnd = new Date(eventDate);
  eventDayEnd.setHours(23, 59, 59, 999);

  const duplicate = await CaseEvent.findOne({
    case: caseDoc._id,
    event_type: eventData.event_type,
    event_date: { $gte: eventDayStart, $lte: eventDayEnd },
  });

  if (duplicate) {
    errors.push(
      `A "${eventData.event_type}" event already exists on ${eventDate.toISOString().split('T')[0]}. Duplicate events on the same day are not allowed.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate the overall timeline consistency for a case.
 * Can be called to audit existing data.
 *
 * @param {string} caseId
 * @returns {{ valid: boolean, warnings: string[] }}
 */
async function auditTimeline(caseId) {
  const warnings = [];

  const events = await CaseEvent.find({ case: caseId })
    .sort({ event_date: 1 })
    .lean();

  if (events.length === 0) {
    warnings.push('No events found for this case.');
    return { valid: true, warnings };
  }

  // Check for date sequence issues
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];

    // Hearing after judgment is suspicious
    if (prev.event_type === 'judgment' && curr.event_type === 'hearing') {
      warnings.push(
        `Hearing on ${new Date(curr.event_date).toISOString().split('T')[0]} occurs after judgment on ${new Date(prev.event_date).toISOString().split('T')[0]}. This may indicate an appeal.`
      );
    }
  }

  // Check adjournment count consistency
  const adjournmentEvents = events.filter(e => e.event_type === 'adjournment');
  // We just report, don't block
  if (adjournmentEvents.length > 0) {
    const withoutReason = adjournmentEvents.filter(e => !e.adjournment_reason);
    if (withoutReason.length > 0) {
      warnings.push(`${withoutReason.length} adjournment event(s) are missing reasons.`);
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

module.exports = {
  validateTimelineEvent,
  auditTimeline,
};
