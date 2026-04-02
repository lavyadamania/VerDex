// ============================================================
// Alert Generation Service
// ============================================================
// Centralized service for creating alerts in the database.
// Handles deduplication (no duplicate alerts within a window),
// severity mapping, and bulk operations.
//
// Used by:
//   - Hearing Reminder Worker (Stage 11)
//   - Delay Detection Worker (Stage 10)
//   - Document verification, disclosure, error detection, etc.
// ============================================================
const Alert = require('../models/Alert');
const logger = require('../utils/logger');
const { publishToUser } = require('./eventPublisher');

// Default dedup window: 24 hours (don't re-alert for same thing within this period)
const DEFAULT_DEDUP_HOURS = 24;

/**
 * Create a single alert with deduplication.
 * Won't create a duplicate alert for the same case + type + user within the dedup window.
 *
 * @param {Object} params
 * @param {string} params.caseId       - Case ObjectId
 * @param {string} params.userId       - User ObjectId (alert recipient)
 * @param {string} params.alertType    - One of Alert.alert_type enum values
 * @param {string} params.title        - Alert title
 * @param {string} params.message      - Alert message body
 * @param {string} params.severity     - 'low' | 'medium' | 'high' | 'critical'
 * @param {number} [params.dedupHours] - Dedup window in hours (default: 24)
 * @returns {Object|null} The created alert, or null if deduplicated
 */
async function createAlert({
  caseId,
  userId,
  alertType,
  title,
  message,
  severity = 'medium',
  dedupHours = DEFAULT_DEDUP_HOURS,
}) {
  try {
    // Deduplication check: don't create if same alert exists within window
    if (dedupHours > 0) {
      const windowStart = new Date(Date.now() - dedupHours * 60 * 60 * 1000);
      const existing = await Alert.findOne({
        case: caseId,
        user: userId,
        alert_type: alertType,
        createdAt: { $gte: windowStart },
      });

      if (existing) {
        logger.debug(`Alert deduped: ${alertType} for case ${caseId} (existing from ${existing.createdAt})`);
        return null;
      }
    }

    const alert = await Alert.create({
      case: caseId,
      user: userId,
      alert_type: alertType,
      alert_title: title,
      alert_message: message,
      severity,
    });

    logger.info(`🔔 Alert created: [${severity}] ${alertType} for user ${userId} — ${title}`);

    // ── Publish real-time event via Redis Pub/Sub ──
    publishToUser(userId, 'new_alert', {
      alertId: alert._id,
      alertType,
      title,
      message,
      severity,
      caseId,
    }).catch(() => {}); // Fire-and-forget, never block

    return alert;
  } catch (err) {
    logger.error({ err }, `Failed to create alert: ${alertType} for case ${caseId}`);
    return null;
  }
}

/**
 * Create a hearing reminder alert.
 *
 * @param {Object} caseDoc  - Case document (with cnr_number, victim_user, next_hearing_date, court)
 * @param {number} daysUntil - Days until the hearing (e.g. 3, 1)
 */
async function createHearingReminder(caseDoc, daysUntil) {
  if (!caseDoc.victim_user) return null;

  const hearingDate = new Date(caseDoc.next_hearing_date);
  const formattedDate = hearingDate.toLocaleDateString('en-IN', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const urgency = daysUntil <= 1 ? 'TOMORROW' : `in ${daysUntil} days`;
  const severity = daysUntil <= 1 ? 'high' : 'medium';

  const title = `📅 Hearing ${urgency} — ${caseDoc.cnr_number}`;
  const message = daysUntil <= 1
    ? `⚠️ Your hearing for case ${caseDoc.cnr_number} is TOMORROW (${formattedDate}). Please ensure you are prepared and have all necessary documents ready. Contact your advocate if needed.`
    : `Your hearing for case ${caseDoc.cnr_number} is scheduled ${urgency} on ${formattedDate}. Please prepare your documents and coordinate with your advocate.`;

  return createAlert({
    caseId: caseDoc._id,
    userId: caseDoc.victim_user,
    alertType: 'hearing_reminder',
    title,
    message,
    severity,
    dedupHours: daysUntil <= 1 ? 12 : 24, // Tighter dedup for 1-day reminders
  });
}

/**
 * Get a user's alerts with pagination and filters.
 *
 * @param {string} userId
 * @param {Object} options
 * @param {number} options.page    - Page number (default 1)
 * @param {number} options.limit   - Items per page (default 20)
 * @param {string} options.filter  - 'all' | 'unread' | 'read' (default 'all')
 * @param {string} options.type    - Optional alert_type filter
 * @returns {Object} { alerts, pagination, unreadCount }
 */
async function getUserAlerts(userId, { page = 1, limit = 20, filter = 'all', type = null } = {}) {
  const query = { user: userId };

  if (filter === 'unread') query.is_read = false;
  if (filter === 'read') query.is_read = true;
  if (type) query.alert_type = type;

  // Don't show dismissed alerts
  query.is_dismissed = { $ne: true };

  const skip = (page - 1) * limit;

  const [alerts, total, unreadCount] = await Promise.all([
    Alert.find(query)
      .populate('case', 'cnr_number case_type current_status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Alert.countDocuments(query),
    Alert.countDocuments({ user: userId, is_read: false, is_dismissed: { $ne: true } }),
  ]);

  return {
    alerts,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    unreadCount,
  };
}

/**
 * Mark a single alert as read.
 *
 * @param {string} alertId
 * @param {string} userId - For ownership verification
 * @returns {Object|null} Updated alert or null
 */
async function markAlertRead(alertId, userId) {
  const alert = await Alert.findOneAndUpdate(
    { _id: alertId, user: userId },
    { is_read: true },
    { new: true }
  );
  return alert;
}

/**
 * Mark all unread alerts as read for a user.
 *
 * @param {string} userId
 * @returns {number} Number of alerts marked as read
 */
async function markAllAlertsRead(userId) {
  const result = await Alert.updateMany(
    { user: userId, is_read: false },
    { is_read: true }
  );
  return result.modifiedCount;
}

/**
 * Dismiss (soft-delete) an alert.
 *
 * @param {string} alertId
 * @param {string} userId
 * @returns {Object|null}
 */
async function dismissAlert(alertId, userId) {
  const alert = await Alert.findOneAndUpdate(
    { _id: alertId, user: userId },
    { is_dismissed: true },
    { new: true }
  );
  return alert;
}

/**
 * Get unread alert count for a user (used for badge/notification count).
 *
 * @param {string} userId
 * @returns {number}
 */
async function getUnreadCount(userId) {
  return Alert.countDocuments({ user: userId, is_read: false, is_dismissed: { $ne: true } });
}

module.exports = {
  createAlert,
  createHearingReminder,
  getUserAlerts,
  markAlertRead,
  markAllAlertsRead,
  dismissAlert,
  getUnreadCount,
};
