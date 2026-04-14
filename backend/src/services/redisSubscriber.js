// ============================================================
// Redis Subscriber — Bridges Redis to Socket.io
// ============================================================
const { getRedisSubscriber } = require('../config/redis');
const logger = require('../utils/logger');
const { broadcastEvent } = require('./sseBroker');

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
    const parsed = JSON.parse(eventPayloadJson);

    const inner = parsed?.data && parsed.data.payload !== undefined ? parsed.data : parsed;
    const payload = inner?.payload && typeof inner.payload === 'object' ? inner.payload : (parsed.payload || parsed.data || parsed);

    const realtimeEvent = {
      type: inner.type || parsed.type || 'CASE_UPDATE',
      caseId: inner.caseId || parsed.caseId || payload?.caseId || null,
      payload,
      timestamp: inner.timestamp || parsed.timestamp || Date.now(),
    };

    const eventObj = {
      caseId: realtimeEvent.caseId,
      type: realtimeEvent.type,
      payload: realtimeEvent.payload,
      timestamp: realtimeEvent.timestamp,
      createdAt: new Date(realtimeEvent.timestamp).toISOString(),
      message: realtimeEvent.payload?.message || realtimeEvent.payload?.summary || realtimeEvent.type,
      rolesVisibleTo: realtimeEvent.payload?.rolesVisibleTo || [],
      usersVisibleTo: realtimeEvent.payload?.usersVisibleTo || [],
    };

    if (eventObj.caseId) {
      io.to(`case_${eventObj.caseId}`).emit('live_event', eventObj);
    }

    if (eventObj.rolesVisibleTo.length) {
      eventObj.rolesVisibleTo.forEach((role) => {
        io.to(`role_${role}`).emit('live_event', eventObj);
      });
    } else {
      io.emit('live_event', eventObj);
    }

    if (eventObj.usersVisibleTo.length) {
      eventObj.usersVisibleTo.forEach((userId) => {
        io.to(`user_${userId}`).emit('live_event', eventObj);
      });
    }

    broadcastEvent(realtimeEvent);
    logger.debug(`📡 Event forwarded via Socket.io + SSE: ${eventObj.type}`);
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
    const channels = ['case_updates', 'delay_alerts', 'leaderboard_updates'];

    // Subscribe to channel and listen for messages
    redis.on('message', (channel, message) => {
      if (channels.includes(channel)) {
        forwardEventToClients(io, message);
      }
    });

    // Subscribe to core realtime channels
    redis.subscribe(...channels, (err) => {
      if (err) {
        logger.error(`❌ Failed to subscribe to realtime channels: ${err.message}`);
      } else {
        logger.info(`✅ Subscribed to Redis channels: ${channels.join(', ')}`);
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
