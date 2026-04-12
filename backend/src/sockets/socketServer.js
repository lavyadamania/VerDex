// ============================================================
// Socket.io Server — Real-Time Connection Management
// ============================================================
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const logger = require('../utils/logger');

let ioInstance = null;

/**
 * Initialize Socket.io with Express server.
 * Sets up CORS, authentication, and connection handlers.
 *
 * @param {http.Server} httpServer - Express/HTTP server instance
 */
function initializeSocketServer(httpServer) {
  if (ioInstance) {
    logger.warn('Socket.io already initialized');
    return ioInstance;
  }

  try {
    ioInstance = socketIo(httpServer, {
      cors: {
        origin: env.isDev ? '*' : process.env.FRONTEND_URL,
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    // ── Authentication Middleware ──
    ioInstance.use((socket, next) => {
      try {
        const token = socket.handshake.auth.token;

        if (!token) {
          // Allow unauthenticated connections (e.g., public dashboard)
          socket.data.user = null;
          socket.data.role = 'visitor';
          return next();
        }

        // Verify JWT
        const decoded = jwt.verify(token, env.JWT_SECRET);
        socket.data.userId = decoded.userId;
        socket.data.role = decoded.role;

        next();
      } catch (err) {
        logger.warn(`⚠️  Socket auth failed: ${err.message}`);
        socket.data.user = null;
        socket.data.role = 'visitor';
        next();
      }
    });

    // ── Connection Handler ──
    ioInstance.on('connection', (socket) => {
      const { userId, role } = socket.data;

      logger.info(`🔌 Socket connected: ${socket.id} (User: ${userId || 'guest'}, Role: ${role})`);

      // ── Join Rooms Based on Role/User ──
      if (userId) {
        socket.join(`user_${userId}`);
      }
      socket.join(`role_${role}`);

      // ── Handle Custom Events ──

      // Client requests to join a case room
      socket.on('join_case', (caseId) => {
        if (caseId) {
          socket.join(`case_${caseId}`);
          logger.debug(`📍 Socket ${socket.id} joined case room: ${caseId}`);
        }
      });

      // Client leaves a case room
      socket.on('leave_case', (caseId) => {
        if (caseId) {
          socket.leave(`case_${caseId}`);
          logger.debug(`📍 Socket ${socket.id} left case room: ${caseId}`);
        }
      });

      // Heartbeat (ping/pong to keep alive)
      socket.on('ping', () => {
        socket.emit('pong');
      });

      // ── Disconnection Handler ──
      socket.on('disconnect', () => {
        logger.info(`🔌 Socket disconnected: ${socket.id}`);
      });

      // ── Error Handler ──
      socket.on('error', (err) => {
        logger.error(`❌ Socket error (${socket.id}): ${err}`);
      });
    });

    logger.info('✅ Socket.io server initialized');

    return ioInstance;
  } catch (err) {
    logger.error(`❌ Failed to initialize Socket.io: ${err.message}`);
    throw err;
  }
}

/**
 * Get the Socket.io instance.
 */
function getIO() {
  if (!ioInstance) {
    throw new Error('Socket.io not initialized. Call initializeSocketServer first.');
  }
  return ioInstance;
}

/**
 * Broadcast event to specific users by role.
 */
function broadcastToRole(role, eventName, data) {
  if (!ioInstance) return;
  ioInstance.to(`role_${role}`).emit(eventName, data);
}

/**
 * Broadcast event to specific user.
 */
function broadcastToUser(userId, eventName, data) {
  if (!ioInstance) return;
  ioInstance.to(`user_${userId}`).emit(eventName, data);
}

/**
 * Broadcast event to case room.
 */
function broadcastToCase(caseId, eventName, data) {
  if (!ioInstance) return;
  ioInstance.to(`case_${caseId}`).emit(eventName, data);
}

module.exports = {
  initializeSocketServer,
  getIO,
  broadcastToRole,
  broadcastToUser,
  broadcastToCase,
};
