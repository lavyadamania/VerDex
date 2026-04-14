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
const { startHearingReminderScheduler, stopHearingReminderScheduler } = require('./workers/hearingReminder');
const { startLeaderboardRefreshScheduler, stopLeaderboardRefreshScheduler } = require('./workers/leaderboardRefresh');
const { startAIWorker, stopAIWorker } = require('./workers/aiProcessing');
const { startRealtimeDemoActivity, stopRealtimeDemoActivity } = require('./workers/realtimeDemoActivity');
const aiService = require('./services/aiService');

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
    message: '[SYSTEM] Court Transparency & Justice Accountability System API',
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
        map: 'GET /api/courts/map',
        mapStats: 'GET /api/courts/map/stats',
        mapDetail: 'GET /api/courts/map/:id',
      },
      delays: {
        summary: 'GET /api/delays/summary',
        cases: 'GET /api/delays/cases',
        scan: 'POST /api/delays/scan',
        history: 'GET /api/delays/history/:caseId',
        redisSets: 'GET /api/delays/redis-sets',
      },
      alerts: {
        list: 'GET /api/alerts',
        unreadCount: 'GET /api/alerts/count',
        markRead: 'PATCH /api/alerts/:id/read',
        markAllRead: 'PATCH /api/alerts/read-all',
        dismiss: 'PATCH /api/alerts/:id/dismiss',
        adminAll: 'GET /api/alerts/admin/all',
      },
      leaderboard: {
        rankings: 'GET /api/leaderboard',
        stats: 'GET /api/leaderboard/stats',
        courtAnalytics: 'GET /api/leaderboard/court/:id',
        refresh: 'POST /api/leaderboard/refresh',
      },
      verification: {
        validateCnr: 'POST /api/verification/validate-cnr',
        status: 'GET /api/verification/status',
        advocate: 'POST /api/verification/advocate',
        uploadId: 'POST /api/verification/upload-id/:caseId',
        requestUpgrade: 'POST /api/verification/request-upgrade',
        adminOverride: 'PATCH /api/verification/admin/:userId',
        adminUsers: 'GET /api/verification/admin/users',
      },
      disclosure: {
        fields: 'GET /api/disclosure/fields',
        submit: 'POST /api/disclosure/request',
        myRequests: 'GET /api/disclosure/my-requests',
        caseHistory: 'GET /api/disclosure/case/:caseId',
        review: 'PATCH /api/disclosure/:id/review',
        revoke: 'POST /api/disclosure/:id/revoke',
        adminPending: 'GET /api/disclosure/admin/pending',
      },
      public: {
        cases: 'GET /api/public/cases',
        caseDetail: 'GET /api/public/cases/:maskedId',
        stats: 'GET /api/public/stats',
        courts: 'GET /api/public/courts',
        courtDetail: 'GET /api/public/courts/:id',
      },
      admin: {
        stats: 'GET /api/admin/stats',
        allCases: 'GET /api/admin/cases',
        stuckCases: 'GET /api/admin/stuck-cases',
        courtAnalytics: 'GET /api/admin/court-analytics',
        auditLogs: 'GET /api/admin/audit-logs',
        users: 'GET /api/admin/users',
      },
      errors: {
        scanCase: 'POST /api/errors/scan/:caseId',
        scanAll: 'POST /api/errors/scan-all',
        summary: 'GET /api/errors/summary',
        casesWithErrors: 'GET /api/errors/cases',
      },
      sse: {
        events: 'GET /api/sse/events?token=JWT',
        status: 'GET /api/sse/status',
      },
      ai: {
        status: 'GET /api/ai/status',
        analyze: 'POST /api/ai/analyze/:documentId',
        analyzeSync: 'POST /api/ai/analyze-sync/:documentId',
        extractText: 'POST /api/ai/extract-text/:documentId',
        summarize: 'POST /api/ai/summarize/:documentId',
        classify: 'POST /api/ai/classify/:documentId',
        queue: 'GET /api/ai/queue',
      },
    },
  });
});

// ── API Routes ──
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/cases', require('./routes/case.routes'));
app.use('/api/courts/map', require('./routes/map.routes'));
app.use('/api/courts', require('./routes/court.routes'));
app.use('/api/documents', require('./routes/document.routes'));
app.use('/api/delays', require('./routes/delay.routes'));
app.use('/api/alerts', require('./routes/alert.routes'));
app.use('/api/leaderboard', require('./routes/leaderboard.routes'));
app.use('/api/verification', require('./routes/verification.routes'));
app.use('/api/disclosure', require('./routes/disclosure.routes'));
app.use('/api/public', require('./routes/public.routes'));
app.use('/api/admin', require('./routes/admin.routes'));
app.use('/api/errors', require('./routes/errorDetection.routes'));
app.use('/api/sse', require('./routes/sse.routes'));
app.use('/api/ai', require('./routes/ai.routes'));
app.use('/api/events', require('./routes/events.routes'));

// ── 404 handler ──
app.use(notFoundHandler);

// ── Global error handler ──
app.use(errorHandler);

// ============================================================
// SERVER STARTUP
// ============================================================
async function startServer() {
  logger.info('---------------------------------------------------');
  logger.info('  [SYSTEM] Court Transparency System -- Starting...');
  logger.info('---------------------------------------------------');

  // Connect to MongoDB
  const dbConnected = await connectDB();
  if (!dbConnected) {
    logger.error('Failed to connect to MongoDB initially. Starting in limited mode...');
    // process.exit(1); // ← REMOVED: Don't crash, let the server start
  }

  // Connect to Redis (or fallback to in-memory)
  await connectRedis();

  // Geo-index courts for the delay heatmap
  try {
    const { geoAddAllCourts } = require('./services/courtMapService');
    await geoAddAllCourts();
  } catch (geoErr) {
    logger.warn(`[WARNING] Court geo-indexing failed on startup: ${geoErr.message}`);
  }

  // Initialize AI service
  const aiStatus = aiService.initializeAI();
  logger.info(`[AI] AI: Gemini=${aiStatus.geminiAvailable ? '[SUCCESS]' : '[ERROR]'} Groq=${aiStatus.groqAvailable ? '[SUCCESS]' : '[ERROR]'}`);

  // Start HTTP server
  const server = app.listen(env.PORT, '0.0.0.0', () => {
    logger.info('---------------------------------------------------');
    logger.info(`  [START] Server running on http://localhost:${env.PORT}`);
    logger.info(`  [STATS] Health: http://localhost:${env.PORT}/health`);
    logger.info(`  [LIST] API:    http://localhost:${env.PORT}/api`);
    logger.info(`  [ENV] Env:    ${env.NODE_ENV}`);
    logger.info(`  [DB] DB:     MongoDB`);
    logger.info('---------------------------------------------------');

    // ── Initialize Socket.io for Real-Time Events ──
    const { initializeSocketServer } = require('./sockets/socketServer');
    const { initializeRedisSubscriber, startListening } = require('./services/redisSubscriber');

    try {
      const io = initializeSocketServer(server);
      initializeRedisSubscriber(io);
      startListening(io);
      logger.info('✅ Real-Time Live Monitoring System activated');
    } catch (socketErr) {
      logger.error(`⚠️  Socket.io initialization failed: ${socketErr.message}`);
    }

    // ── Start Background Workers ──
    startDelayDetectionScheduler().catch(err => {
      logger.error({ err }, 'Failed to start delay detection scheduler');
    });
    startHearingReminderScheduler().catch(err => {
      logger.error({ err }, 'Failed to start hearing reminder scheduler');
    });
    startLeaderboardRefreshScheduler().catch(err => {
      logger.error({ err }, 'Failed to start leaderboard refresh scheduler');
    });
    startAIWorker().catch(err => {
      logger.error({ err }, 'Failed to start AI processing worker');
    });

    if (process.env.ENABLE_REALTIME_DEMO === 'true') {
      startRealtimeDemoActivity().catch(err => {
        logger.error({ err }, 'Failed to start realtime demo activity worker');
      });
    }
  });

  // ── Graceful Shutdown ──
  const shutdown = async (signal) => {
    logger.info(`\n${signal} received — shutting down gracefully...`);
    server.close(async () => {
      logger.info('HTTP server closed');
      await stopDelayDetectionScheduler();
      await stopHearingReminderScheduler();
      await stopLeaderboardRefreshScheduler();
      await stopAIWorker();
      await stopRealtimeDemoActivity();
      await disconnectRedis();
      await closeDB();
      logger.info('Goodbye! [GOODBYE]');
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
