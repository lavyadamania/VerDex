// ============================================================
// Redis Subscriber — Bridges Redis to Socket.io
// ============================================================
const { getRedisSubscriber } = require('../config/redis');
const logger = require('../utils/logger');

let subscriberInstance = null;

/**
 * Initialize Redis subscriber for case_updates channel.
 * When events are published, this forwards them to Socket.io.
 *
 * @param {Object} io - Socket.io server instance
 */
function initializeRedisSubscriber(io) {
  if (subscriberInstance) {
    logger.warn('Redis subscriber already initialized');
    return subscriberInstance;
  }

  try {
    // Use the dedicated subscriber connection
    const redis = getRedisSubscriber();
    
    // Note: ioredis automatically handles blocking mode for pub/sub
    // We'll use a simple event listener pattern

    logger.info('🔄 Redis subscriber initialized for case_updates channel');

    subscriberInstance = {
      io,
      connected: true,
    };

    return subscriberInstance;
  } catch (err) {
    logger.error(`❌ Failed to initialize Redis subscriber: ${err.message}`);
    throw err;
  }
}

/**
 * Handle incoming Redis events and forward to Socket.io clients.
 * This bridges Redis Pub/Sub → Socket.io emissions.
 *
 * @param {Object} io - Socket.io instance
 * @param {String} eventPayloadJson - JSON stringified event
 */
function forwardEventToClients(io, eventPayloadJson) {
  try {
    const event = JSON.parse(eventPayloadJson);

    // Emit to all connected sockets (Socket.io handles filtering)
    const eventObj = {
      _id: event._id,
      caseId: event.caseId,
      type: event.type,
      message: event.message,
      metadata: event.metadata,
      createdBy: event.createdBy,
      rolesVisibleTo: event.rolesVisibleTo,
      usersVisibleTo: event.usersVisibleTo,
      createdAt: event.createdAt,
    };

    // Broadcast to specific case room
    if (event.caseId) {
      io.to(`case_${event.caseId}`).emit('live_event', eventObj);
    }

    // Broadcast to role-based rooms
    if (event.rolesVisibleTo && Array.isArray(event.rolesVisibleTo)) {
      event.rolesVisibleTo.forEach(role => {
        io.to(`role_${role}`).emit('live_event', eventObj);
      });
    }

    // Broadcast to specific user rooms
    if (event.usersVisibleTo && Array.isArray(event.usersVisibleTo)) {
      event.usersVisibleTo.forEach(userId => {
        io.to(`user_${userId}`).emit('live_event', eventObj);
      });
    }

    logger.debug(`📡 Event forwarded via Socket.io: ${event.type}`);
  } catch (err) {
    logger.error(`❌ Failed to forward event to clients: ${err.message}`);
  }
}

/**
 * Start listening to Redis pub/sub.
 * This must be called after Socket.io is initialized.
 */
function startListening(io) {
  try {
    const redis = getRedisSubscriber();  // Use dedicated subscriber connection

    // Subscribe to channel and listen for messages
    redis.on('message', (channel, message) => {
      if (channel === 'case_updates') {
        forwardEventToClients(io, message);
      }
    });

    // Subscribe to the channel
    redis.subscribe('case_updates', (err) => {
      if (err) {
        logger.error(`❌ Failed to subscribe to case_updates: ${err.message}`);
      } else {
        logger.info('✅ Subscribed to case_updates Redis channel');
      }
    });
  } catch (err) {
    logger.error(`❌ Failed to start Redis listening: ${err.message}`);
  }
}

function getSubscriber() {
  return subscriberInstance;
}

module.exports = {
  initializeRedisSubscriber,
  startListening,
  getSubscriber,
  forwardEventToClients,
};
