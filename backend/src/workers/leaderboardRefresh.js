// ============================================================
// Leaderboard Refresh Worker (BullMQ + setInterval fallback)
// ============================================================
// Periodically recomputes court performance rankings and stores
// them in Redis sorted sets for fast public API reads.
//
// Scheduling:
//   - Uses BullMQ repeatable job when real Redis is available
//   - Falls back to setInterval when using in-memory Redis
//   - Default interval: every 6 hours
// ============================================================
const { getRedis, isMemoryStore } = require('../config/redis');
const { computeLeaderboard } = require('../services/leaderboardService');
const logger = require('../utils/logger');

// Track scheduler handles for graceful shutdown
let bullmqWorker = null;
let bullmqQueue = null;
let fallbackInterval = null;

// ============================================================
// BullMQ-based Scheduler (real Redis)
// ============================================================
async function startBullMQScheduler(intervalMs) {
  const { Queue, Worker } = require('bullmq');
  const redis = getRedis();

  const connection = {
    host: redis.options?.host || 'localhost',
    port: redis.options?.port || 6379,
    password: redis.options?.password || undefined,
  };

  if (redis.options?.connectionName || redis.options?.tls) {
    connection.tls = redis.options.tls || {};
  }

  bullmqQueue = new Queue('leaderboard-refresh', { connection });

  // Remove existing repeatable jobs
  const existingJobs = await bullmqQueue.getRepeatableJobs();
  for (const job of existingJobs) {
    await bullmqQueue.removeRepeatableByKey(job.key);
  }

  // Add repeatable job
  await bullmqQueue.add(
    'refresh-leaderboard',
    { triggeredBy: 'scheduler' },
    {
      repeat: { every: intervalMs },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 20 },
    }
  );

  bullmqWorker = new Worker(
    'leaderboard-refresh',
    async (job) => {
      logger.info(`📋 BullMQ job ${job.id} — refreshing leaderboard...`);
      const result = await computeLeaderboard();
      return { courts: result.courts.length, elapsed: result.elapsed };
    },
    { connection, concurrency: 1 }
  );

  bullmqWorker.on('completed', (job, result) => {
    logger.info(`✅ BullMQ leaderboard job ${job.id} completed — ${result.courts} courts ranked`);
  });

  bullmqWorker.on('failed', (job, err) => {
    logger.error({ err }, `❌ BullMQ leaderboard job ${job?.id} failed`);
  });

  logger.info(`📊 BullMQ leaderboard refresh scheduler started (interval: ${(intervalMs / 3600000).toFixed(1)}h)`);

  // Initial computation after 20s (stagger after other workers)
  setTimeout(async () => {
    try {
      await computeLeaderboard();
    } catch (err) {
      logger.error({ err }, 'Initial leaderboard computation failed');
    }
  }, 20000);
}

// ============================================================
// setInterval-based Scheduler (fallback)
// ============================================================
function startFallbackScheduler(intervalMs) {
  logger.info(`📊 Fallback leaderboard refresh scheduler started (interval: ${(intervalMs / 3600000).toFixed(1)}h)`);

  setTimeout(async () => {
    try {
      await computeLeaderboard();
    } catch (err) {
      logger.error({ err }, 'Initial leaderboard computation failed');
    }
  }, 20000);

  fallbackInterval = setInterval(async () => {
    try {
      await computeLeaderboard();
    } catch (err) {
      logger.error({ err }, 'Scheduled leaderboard refresh failed');
    }
  }, intervalMs);
}

// ============================================================
// Public API: Start / Stop
// ============================================================

/**
 * Start the leaderboard refresh scheduler.
 * @param {number} intervalMs - Default: 6 hours
 */
async function startLeaderboardRefreshScheduler(intervalMs = 6 * 60 * 60 * 1000) {
  if (!isMemoryStore()) {
    try {
      await startBullMQScheduler(intervalMs);
      return;
    } catch (err) {
      logger.warn({ err }, '⚠️ BullMQ setup failed for leaderboard — falling back to setInterval');
    }
  }
  startFallbackScheduler(intervalMs);
}

/**
 * Stop the leaderboard refresh scheduler.
 */
async function stopLeaderboardRefreshScheduler() {
  if (bullmqWorker) {
    await bullmqWorker.close();
    bullmqWorker = null;
    logger.info('📊 BullMQ leaderboard worker stopped');
  }
  if (bullmqQueue) {
    await bullmqQueue.close();
    bullmqQueue = null;
    logger.info('📊 BullMQ leaderboard queue closed');
  }
  if (fallbackInterval) {
    clearInterval(fallbackInterval);
    fallbackInterval = null;
    logger.info('📊 Fallback leaderboard scheduler stopped');
  }
}

module.exports = {
  startLeaderboardRefreshScheduler,
  stopLeaderboardRefreshScheduler,
};
