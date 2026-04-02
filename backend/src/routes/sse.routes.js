// ============================================================
// SSE Routes — Server-Sent Events for Real-Time Updates
// ============================================================
// Provides a persistent SSE connection for authenticated users.
// Each connection subscribes to the user's Redis Pub/Sub channel
// and the global channel. Events are pushed as they arrive.
//
// Endpoints:
//   GET /api/sse/events    — SSE stream (authenticated)
//   GET /api/sse/status    — Connection stats (admin)
// ============================================================
const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { subscribe } = require('../services/eventPublisher');
const logger = require('../utils/logger');

// ── Active SSE connections registry ──
// Map<userId_string, Set<response>>
const activeConnections = new Map();

/**
 * Get the count of active SSE connections.
 */
function getActiveConnectionCount() {
  let total = 0;
  for (const conns of activeConnections.values()) {
    total += conns.size;
  }
  return total;
}

// ============================================================
// GET /api/sse/events — SSE endpoint
// ============================================================
// Opens a persistent connection. The client uses EventSource API:
//   const es = new EventSource('/api/sse/events', { headers: ... })
//   es.onmessage = (e) => console.log(JSON.parse(e.data))
//
// Note: EventSource doesn't support custom headers natively.
// Token is passed as a query parameter: ?token=JWT
// ============================================================
router.get('/events', async (req, res, next) => {
  try {
    // ── Auth via query param (EventSource can't set headers) ──
    const token = req.query.token;
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Authentication token required. Pass as ?token=JWT',
      });
    }

    // Manually verify JWT
    const jwt = require('jsonwebtoken');
    const env = require('../config/env');
    const User = require('../models/User');

    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token',
      });
    }

    const user = await User.findById(decoded.userId).select('_id full_name role');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found',
      });
    }

    const userId = user._id.toString();

    // ── Set SSE headers ──
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    });

    // ── Send initial connection event ──
    const connectPayload = JSON.stringify({
      type: 'connected',
      data: {
        userId,
        name: user.full_name,
        role: user.role,
        message: 'SSE connection established',
      },
      timestamp: new Date().toISOString(),
    });
    res.write(`data: ${connectPayload}\n\n`);

    // ── Register connection ──
    if (!activeConnections.has(userId)) {
      activeConnections.set(userId, new Set());
    }
    activeConnections.get(userId).add(res);

    logger.info(`📡 SSE connected: ${user.full_name} (${userId}) — ${getActiveConnectionCount()} total`);

    // ── Subscribe to Redis Pub/Sub channels ──
    const channels = [`user:${userId}`, 'global'];

    const subscription = subscribe(channels, (channel, message) => {
      // Forward message to SSE client
      try {
        res.write(`data: ${message}\n\n`);
      } catch (err) {
        // Connection might be closed
        logger.debug(`SSE write failed for ${userId}, connection may be closed`);
      }
    });

    // ── Heartbeat — keep connection alive ──
    const heartbeatInterval = setInterval(() => {
      try {
        res.write(`: heartbeat\n\n`);
      } catch (err) {
        clearInterval(heartbeatInterval);
      }
    }, 30000); // Every 30 seconds

    // ── Cleanup on disconnect ──
    const cleanup = () => {
      clearInterval(heartbeatInterval);

      // Remove from active connections
      const userConns = activeConnections.get(userId);
      if (userConns) {
        userConns.delete(res);
        if (userConns.size === 0) {
          activeConnections.delete(userId);
        }
      }

      // Unsubscribe from Redis channels
      if (subscription && subscription.unsubscribe) {
        subscription.unsubscribe().catch(() => {});
      }

      logger.info(`📡 SSE disconnected: ${userId} — ${getActiveConnectionCount()} remaining`);
    };

    req.on('close', cleanup);
    req.on('error', cleanup);

  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/sse/status — Connection stats (admin only)
// ============================================================
router.get('/status', authenticate, authorize('admin'), (req, res) => {
  const connections = [];
  for (const [userId, conns] of activeConnections.entries()) {
    connections.push({
      userId,
      connectionCount: conns.size,
    });
  }

  res.json({
    success: true,
    data: {
      total_connections: getActiveConnectionCount(),
      unique_users: activeConnections.size,
      connections,
    },
  });
});

module.exports = router;
module.exports.getActiveConnectionCount = getActiveConnectionCount;
