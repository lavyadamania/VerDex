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
const { registerConnection, cleanupConnection, getConnectionStats } = require('../services/sseBroker');
const logger = require('../utils/logger');

// ── Active SSE connections registry ──
// Map<userId_string, Set<response>>
const activeConnections = new Map();

/**
 * Get the count of active SSE connections.
 */
function getActiveConnectionCount() {
  const stats = getConnectionStats();
  return stats.total_connections;
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

    let user;
    let userId;

    if (!token) {
      userId = `visitor-${Date.now()}-${Math.round(Math.random() * 1000)}`;
      user = {
        _id: userId,
        full_name: 'Public Visitor',
        role: 'visitor',
      };
    } else {
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

      user = await User.findById(decoded.userId).select('_id full_name role');
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found',
        });
      }

      userId = user._id.toString();
    }

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
    const connectionId = registerConnection({ userId, role: user.role, res });

    logger.info(`📡 SSE connected: ${user.full_name} (${userId}) — ${getActiveConnectionCount()} total`);

    // ── Subscribe to Redis Pub/Sub channels ──
    const channels = user.role === 'visitor' ? ['global'] : [`user:${userId}`, 'global'];

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
      } catch (_err) {
        clearInterval(heartbeatInterval);
      }
    }, 10000); // Every 10 seconds

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
        try {
          const unsubResult = subscription.unsubscribe();
          if (unsubResult && typeof unsubResult.then === 'function') {
            unsubResult.catch(() => { });
          }
        } catch (_err) {
          // ignore unsubscribe cleanup errors
        }
      }

      cleanupConnection(connectionId);

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
  const stats = getConnectionStats();
  const connections = Object.entries(stats.by_user).map(([userId, connectionCount]) => ({
    userId,
    connectionCount,
  }));

  res.json({
    success: true,
    data: {
      total_connections: stats.total_connections,
      unique_users: stats.unique_users,
      connections,
    },
  });
});

module.exports = router;
module.exports.getActiveConnectionCount = getActiveConnectionCount;
