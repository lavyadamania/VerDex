// ============================================================
// Event Publisher Service — Stage 18
// ============================================================
// Publishes real-time events via Redis Pub/Sub so that
// connected SSE clients receive instant updates.
//
// Channels:
//   user:{userId}  — per-user events (alerts, case updates)
//   global         — system-wide broadcasts
//
// Event payload format:
//   { type, data, timestamp }
//
// Falls back gracefully when using in-memory Redis store.
// ============================================================
const { getRedis, isMemoryStore } = require('../config/redis');
const logger = require('../utils/logger');

// ── In-memory subscriber registry (for MemoryRedis fallback) ──
// Map<channel, Set<callback>>
const memorySubscribers = new Map();

const REALTIME_CHANNELS = {
  CASE_UPDATE: 'case_updates',
  DELAY_ALERT: 'delay_alerts',
  LEADERBOARD_UPDATE: 'leaderboard_updates',
  DISCLOSURE_UPDATE: 'case_updates',
};

function buildRealtimeEnvelope(type, caseId, payload = {}) {
  return {
    type,
    caseId: caseId ? caseId.toString() : null,
    payload,
    timestamp: Date.now(),
  };
}

/**
 * Publish an event to a specific user's channel.
 *
 * @param {string} userId - Target user's ObjectId
 * @param {string} eventType - Event type (new_alert, case_update, disclosure_update, etc.)
 * @param {Object} payload - Event data
 */
async function publishToUser(userId, eventType, payload) {
  if (!userId) return;
  const channel = `user:${userId.toString()}`;
  await _publish(channel, eventType, payload);
}

/**
 * Publish an event to the global channel (all connected users).
 *
 * @param {string} eventType - Event type (system_notification, etc.)
 * @param {Object} payload - Event data
 */
async function publishToAll(eventType, payload) {
  await _publish('global', eventType, payload);
}

/**
 * Publish standardized real-time events for dashboards.
 * Payload format:
 * { type, caseId, payload, timestamp }
 */
async function publishRealtimeEvent(type, caseId, payload = {}) {
  const envelope = buildRealtimeEnvelope(type, caseId, payload);
  const channel = REALTIME_CHANNELS[type] || 'case_updates';

  // Publish to dedicated channel for server-side fanout
  await _publish(channel, type, envelope);

  // Publish globally so direct SSE subscribers can also receive it
  await _publish('global', type, envelope);

  return envelope;
}

/**
 * Internal publish function.
 * Uses Redis PUBLISH for real Redis, or direct callback dispatch for MemoryRedis.
 */
async function _publish(channel, eventType, payload) {
  const message = JSON.stringify({
    type: eventType,
    data: payload,
    timestamp: new Date().toISOString(),
  });

  try {
    if (isMemoryStore()) {
      // In-memory fallback: directly call registered callbacks
      const subs = memorySubscribers.get(channel) || new Set();
      const globalSubs = memorySubscribers.get('global') || new Set();

      for (const cb of subs) {
        try { cb(channel, message); } catch (e) { /* ignore */ }
      }
      // Also notify global subscribers if this isn't already the global channel
      if (channel !== 'global') {
        for (const cb of globalSubs) {
          try { cb(channel, message); } catch (e) { /* ignore */ }
        }
      }

      logger.debug(`📡 [Memory] Published to ${channel}: ${eventType}`);
    } else {
      const redis = getRedis();
      await redis.publish(channel, message);
      logger.debug(`📡 [Redis] Published to ${channel}: ${eventType}`);
    }
  } catch (err) {
    // Never break the caller if publish fails
    logger.error({ err }, `Failed to publish event to ${channel}`);
  }
}

/**
 * Subscribe to a Redis Pub/Sub channel.
 * Returns an object with an unsubscribe() method for cleanup.
 *
 * For real Redis: creates a dedicated subscriber connection.
 * For MemoryRedis: registers an in-memory callback.
 *
 * @param {string[]} channels - Channels to subscribe to
 * @param {Function} onMessage - Callback: (channel, messageString) => void
 * @returns {{ unsubscribe: Function }}
 */
function subscribe(channels, onMessage) {
  if (isMemoryStore()) {
    // In-memory fallback
    for (const ch of channels) {
      if (!memorySubscribers.has(ch)) {
        memorySubscribers.set(ch, new Set());
      }
      memorySubscribers.get(ch).add(onMessage);
    }

    logger.debug(`📡 [Memory] Subscribed to: ${channels.join(', ')}`);

    return {
      unsubscribe: () => {
        for (const ch of channels) {
          const subs = memorySubscribers.get(ch);
          if (subs) {
            subs.delete(onMessage);
            if (subs.size === 0) memorySubscribers.delete(ch);
          }
        }
        logger.debug(`📡 [Memory] Unsubscribed from: ${channels.join(', ')}`);
      },
    };
  }

  // Real Redis: create a separate subscriber client
  const Redis = require('ioredis');
  const env = require('../config/env');

  let subClient;
  if (env.REDIS_URL) {
    subClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      connectTimeout: 5000,
      tls: env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
    });
  } else {
    subClient = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      connectTimeout: 3000,
    });
  }

  subClient.on('message', (channel, message) => {
    try {
      onMessage(channel, message);
    } catch (err) {
      logger.error({ err }, `Error in Pub/Sub message handler for ${channel}`);
    }
  });

  subClient.on('error', (err) => {
    logger.error({ err }, 'Redis subscriber connection error');
  });

  // Subscribe to all requested channels
  subClient.subscribe(...channels).then(() => {
    logger.debug(`📡 [Redis] Subscribed to: ${channels.join(', ')}`);
  }).catch((err) => {
    logger.error({ err }, `Failed to subscribe to: ${channels.join(', ')}`);
  });

  return {
    unsubscribe: async () => {
      try {
        await subClient.unsubscribe(...channels);
        await subClient.quit();
        logger.debug(`📡 [Redis] Unsubscribed from: ${channels.join(', ')}`);
      } catch (err) {
        logger.error({ err }, 'Error during unsubscribe');
        try { subClient.disconnect(); } catch (e) { /* ignore */ }
      }
    },
  };
}

/**
 * Get count of in-memory subscribers (for monitoring).
 */
function getSubscriberCount() {
  let total = 0;
  for (const subs of memorySubscribers.values()) {
    total += subs.size;
  }
  return total;
}

module.exports = {
  publishToUser,
  publishToAll,
  publishRealtimeEvent,
  buildRealtimeEnvelope,
  REALTIME_CHANNELS,
  subscribe,
  getSubscriberCount,
};
