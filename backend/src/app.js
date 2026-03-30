// ============================================================
// Express Application — Court Transparency System
// ============================================================
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const mongoose = require('mongoose');

const env = require('./config/env');
const { connectDB, closeDB } = require('./config/database');
const { connectRedis, disconnectRedis, getRedis, isMemoryStore } = require('./config/redis');
const logger = require('./utils/logger');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { startDelayDetectionScheduler, stopDelayDetectionScheduler } = require('./workers/delayDetection');

// ── Create Express app ──
const app = express();

// ── Security Middleware ──
app.use(helmet());
app.use(cors({
  origin: env.isDev ? '*' : process.env.FRONTEND_URL,
  credentials: true,
}));

// ── Body Parsing ──
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Request Logging ──
if (env.isDev) {
  app.use(morgan('dev'));
}

// ── Static Files (uploads) ──
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ============================================================
// ROUTES
// ============================================================

// Health Check
app.get('/health', async (req, res) => {
  const redis = getRedis();

  let dbStatus = 'unknown';
  let redisStatus = 'unknown';

  // Check MongoDB
  try {
    const state = mongoose.connection.readyState;
    // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
    dbStatus = state === 1 ? 'connected (MongoDB)' : `state: ${state}`;
  } catch (e) {
    dbStatus = `error: ${e.message}`;
  }

  // Check Redis
  try {
    const pong = await redis.ping();
    redisStatus = pong === 'PONG'
      ? (isMemoryStore() ? 'connected (in-memory)' : 'connected (Redis)')
      : 'error';
  } catch (e) {
    redisStatus = `error: ${e.message}`;
  }

  const healthy = dbStatus.includes('connected') && redisStatus.includes('connected');

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    service: 'Court Transparency API',
    version: '1.0.0',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(process.uptime())}s`,
    connections: {
      database: dbStatus,
      redis: redisStatus,
    },
  });
});

// API Info
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: '🏛️ Court Transparency & Justice Accountability System API',
    version: '1.0.0',
    database: 'MongoDB',
    endpoints: {
      health: 'GET /health',
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        verifyOtp: 'POST /api/auth/verify-otp',
        resendOtp: 'POST /api/auth/resend-otp',
        refresh: 'POST /api/auth/refresh',
        logout: 'POST /api/auth/logout',
        me: 'GET /api/auth/me',
      },
      cases: {
        list: 'GET /api/cases',
        stats: 'GET /api/cases/stats',
        get: 'GET /api/cases/:id',
        create: 'POST /api/cases',
        update: 'PUT /api/cases/:id',
        status: 'PATCH /api/cases/:id/status',
        delete: 'DELETE /api/cases/:id',
        events: 'GET /api/cases/:id/events',
        addEvent: 'POST /api/cases/:id/events',
      },
      courts: {
        list: 'GET /api/courts',
        get: 'GET /api/courts/:id',
        leaderboard: 'GET /api/courts/leaderboard/rank',
      },
      delays: {
        summary: 'GET /api/delays/summary',
        cases: 'GET /api/delays/cases',
        scan: 'POST /api/delays/scan',
        history: 'GET /api/delays/history/:caseId',
        redisSets: 'GET /api/delays/redis-sets',
      },
      disclosure: '/api/disclosure/* (Stage 14)',
    },
  });
});

// ── API Routes ──
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/cases', require('./routes/case.routes'));
app.use('/api/courts', require('./routes/court.routes'));
app.use('/api/documents', require('./routes/document.routes'));
app.use('/api/delays', require('./routes/delay.routes'));

// ── 404 handler ──
app.use(notFoundHandler);

// ── Global error handler ──
app.use(errorHandler);

// ============================================================
// SERVER STARTUP
// ============================================================
async function startServer() {
  logger.info('═══════════════════════════════════════════════════');
  logger.info('  🏛️  Court Transparency System — Starting...');
  logger.info('═══════════════════════════════════════════════════');

  // Connect to MongoDB
  const dbConnected = await connectDB();
  if (!dbConnected) {
    logger.error('Failed to connect to MongoDB. Exiting.');
    process.exit(1);
  }

  // Connect to Redis (or fallback to in-memory)
  await connectRedis();

  // Start HTTP server
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info('═══════════════════════════════════════════════════');
    logger.info(`  🚀 Server running on http://localhost:${env.PORT}`);
    logger.info(`  📊 Health: http://localhost:${env.PORT}/health`);
    logger.info(`  📋 API:    http://localhost:${env.PORT}/api`);
    logger.info(`  🌍 Env:    ${env.NODE_ENV}`);
    logger.info(`  🗄️  DB:     MongoDB`);
    logger.info('═══════════════════════════════════════════════════');

    // ── Start Background Workers ──
    startDelayDetectionScheduler().catch(err => {
      logger.error({ err }, 'Failed to start delay detection scheduler');
    });
  });

  // ── Graceful Shutdown ──
  const shutdown = async (signal) => {
    logger.info(`\n${signal} received — shutting down gracefully...`);
    server.close(async () => {
      logger.info('HTTP server closed');
      await stopDelayDetectionScheduler();
      await disconnectRedis();
      await closeDB();
      logger.info('Goodbye! 👋');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forced shutdown after 10s timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer();

module.exports = app;
