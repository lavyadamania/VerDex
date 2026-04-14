// ============================================================
// Event Service — Real-Time Event Emission
// ============================================================
const Event = require('../models/Event');
const { publishRealtimeEvent } = require('./eventPublisher');
const logger = require('../utils/logger');

/**
 * Emit a case event to MongoDB and Redis.
 * This is the main function used across controllers to trigger
 * real-time updates and persistent logging.
 *
 * @param {Object} data
 *   - caseId: Case ObjectId (required)
 *   - type: Event type enum (required)
 *   - message: Human-readable message (required)
 *   - createdBy: User ObjectId who triggered the event
 *   - metadata: Additional data (oldValue, newValue, etc.)
 *   - rolesVisibleTo: Array of roles that can see this event
 *   - usersVisibleTo: Array of user IDs that can see this event
 */
async function emitCaseEvent(data) {
  try {
    const {
      caseId,
      type,
      message,
      createdBy = null,
      metadata = {},
      rolesVisibleTo = ['admin', 'court_staff'],
      usersVisibleTo = [],
    } = data;

    if (!caseId || !type || !message) {
      throw new Error('caseId, type, and message are required');
    }

    // ── Save to MongoDB ──
    const event = await Event.create({
      caseId,
      type,
      message,
      createdBy,
      metadata,
      rolesVisibleTo,
      usersVisibleTo,
      eventDate: new Date(),
    });

    // ── Publish standardized real-time event to Redis ──
    const eventPayload = {
      _id: event._id.toString(),
      caseId: caseId.toString(),
      type,
      message,
      metadata,
      createdBy: createdBy?.toString() || null,
      rolesVisibleTo,
      usersVisibleTo: usersVisibleTo.map(id => id.toString()),
      eventDate: event.eventDate.toISOString(),
      createdAt: event.createdAt.toISOString(),
    };

    // Convert domain event into realtime feed event type.
    const realtimeType = ['DELAY_ALERT', 'STAGNATION_FLAG'].includes(type)
      ? 'DELAY_ALERT'
      : 'CASE_UPDATE';

    await publishRealtimeEvent(realtimeType, caseId, eventPayload);

    logger.info(`📡 Event emitted: ${type} for case ${caseId}`);

    return event;
  } catch (err) {
    logger.error(`❌ Event emission failed: ${err.message}`);
    throw err;
  }
}

/**
 * Get recent events for a user based on their role and permissions.
 * Used for initial load and pagination.
 *
 * @param {Object} user - Authenticated user object
 * @param {Number} limit - Number of events to return (default 20)
 * @param {Number} skip - Pagination offset (default 0)
 */
async function getVisibleEvents(user, limit = 20, skip = 0) {
  try {
    if (!user) {
      throw new Error('User is required');
    }

    const { _id: userId, role } = user;

    // Build query filter based on visibility rules
    const query = {
      $or: [
        { rolesVisibleTo: role },
        { usersVisibleTo: userId },
      ],
    };

    const events = await Event.find(query)
      .populate('createdBy', 'full_name email role')
      .populate('caseId', 'cnr_number case_title court')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const total = await Event.countDocuments(query);

    return {
      events,
      pagination: {
        total,
        limit: parseInt(limit),
        skip,
      },
    };
  } catch (err) {
    logger.error(`❌ Failed to get visible events: ${err.message}`);
    throw err;
  }
}

/**
 * Get all events for a specific case.
 * (Filtered by user role/permissions)
 */
async function getCaseEvents(caseId, user, limit = 50) {
  try {
    if (!user) {
      throw new Error('User is required');
    }

    const { _id: userId, role } = user;

    const query = {
      caseId,
      $or: [
        { rolesVisibleTo: role },
        { usersVisibleTo: userId },
      ],
    };

    const events = await Event.find(query)
      .populate('createdBy', 'full_name email role')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .lean();

    return events;
  } catch (err) {
    logger.error(`❌ Failed to get case events: ${err.message}`);
    throw err;
  }
}

module.exports = {
  emitCaseEvent,
  getVisibleEvents,
  getCaseEvents,
};
