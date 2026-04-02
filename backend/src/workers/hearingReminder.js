// ============================================================
// Hearing Reminder Worker (BullMQ + setInterval fallback)
// ============================================================
// Scans all active cases with upcoming hearing dates and
// creates reminder alerts for victims.
//
// Reminder Schedule:
//   - Next hearing in 3 days → medium-priority reminder
//   - Next hearing in 1 day  → high-priority reminder
//
// Scheduling:
//   - Uses BullMQ repeatable job when real Redis is available
//   - Falls back to setInterval when using in-memory Redis
//   - Default interval: every 1 hour
// ============================================================
const Case = require('../models/Case');
const { getRedis, isMemoryStore } = require('../config/redis');
const { createHearingReminder } = require('../services/alertService');
const logger = require('../utils/logger');

// ── Reminder Windows (in days) ──
const REMINDER_WINDOWS = [
  { days: 3, label: '3-day reminder', severity: 'medium' },
  { days: 1, label: '1-day reminder', severity: 'high' },
];

// Track scheduler handles for graceful shutdown
let bullmqWorker = null;
let bullmqQueue = null;
let fallbackInterval = null;

/**
 * Run the hearing reminder scan.
 * Finds all active cases with hearings in the next 1 or 3 days
 * and creates reminder alerts for the victims.
 *
 * @returns {Object} Summary of results
 */
async function runHearingReminderScan() {
  const startTime = Date.now();
  logger.info('🔔 Hearing reminder scan starting...');

  const now = new Date();

  // Counters
  let scanned = 0;
  let reminders3Day = 0;
  let reminders1Day = 0;
  let alertsCreated = 0;
  let skipped = 0;

  try {
    // Calculate date boundaries
    // We look for hearings that fall within each window:
    //   3-day window: hearing is between 2.5 and 3.5 days from now
    //   1-day window: hearing is between 0.5 and 1.5 days from now
    // This prevents re-alerting if the scan runs multiple times

    for (const window of REMINDER_WINDOWS) {
      const windowStart = new Date(now.getTime() + (window.days - 0.5) * 24 * 60 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + (window.days + 0.5) * 24 * 60 * 60 * 1000);

      // Find cases with hearings in this window
      const cases = await Case.find({
        current_status: { $nin: ['disposed', 'judgment'] },
        next_hearing_date: { $gte: windowStart, $lte: windowEnd },
        victim_user: { $ne: null },
      })
        .select('_id cnr_number case_type victim_user next_hearing_date court current_status')
        .populate('court', 'court_name district')
        .lean();

      scanned += cases.length;

      for (const caseDoc of cases) {
        const alert = await createHearingReminder(caseDoc, window.days);

        if (alert) {
          alertsCreated++;
          if (window.days === 3) reminders3Day++;
          if (window.days === 1) reminders1Day++;
        } else {
          skipped++; // Deduplicated or no victim
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    const summary = {
      scanned,
      reminders_3day: reminders3Day,
      reminders_1day: reminders1Day,
      alerts_created: alertsCreated,
      skipped_deduped: skipped,
      elapsed_seconds: parseFloat(elapsed),
      timestamp: now.toISOString(),
    };

    logger.info('═══════════════════════════════════════════════════');
    logger.info('  🔔 Hearing Reminder Scan Complete');
    logger.info(`     Scanned:     ${scanned} cases with upcoming hearings`);
    logger.info(`     📅 3-day:    ${reminders3Day} reminders`);
    logger.info(`     ⚠️  1-day:    ${reminders1Day} reminders`);
    logger.info(`     🔔 Created:  ${alertsCreated} alerts`);
    logger.info(`     ⏭️  Skipped:  ${skipped} (deduped)`);
    logger.info(`     ⏱️  Time:     ${elapsed}s`);
    logger.info('═══════════════════════════════════════════════════');

    // Store last scan info in Redis for monitoring
    try {
      const redis = getRedis();
      await redis.set('hearing_reminder:last_scan', JSON.stringify(summary));
      await redis.set('hearing_reminder:last_scan_at', now.toISOString());
    } catch (redisErr) {
      logger.warn({ err: redisErr }, 'Failed to store scan info in Redis');
    }

    return summary;
  } catch (err) {
    logger.error({ err }, '❌ Hearing reminder scan failed');
    throw err;
  }
}

// ============================================================
// BullMQ-based Scheduler (real Redis)
// ============================================================

/**
 * Start hearing reminders using BullMQ repeatable job.
 * Requires real Redis — will not work with in-memory fallback.
 */
async function startBullMQScheduler(intervalMs) {
  const { Queue, Worker } = require('bullmq');
  const redis = getRedis();

  // Get Redis connection options for BullMQ
  const connection = {
    host: redis.options?.host || 'localhost',
    port: redis.options?.port || 6379,
    password: redis.options?.password || undefined,
  };

  if (redis.options?.connectionName || redis.options?.tls) {
    connection.tls = redis.options.tls || {};
  }

  // Create BullMQ Queue
  bullmqQueue = new Queue('hearing-reminders', { connection });

  // Remove any existing repeatable jobs (avoid duplicates on restart)
  const existingJobs = await bullmqQueue.getRepeatableJobs();
  for (const job of existingJobs) {
    await bullmqQueue.removeRepeatableByKey(job.key);
  }

  // Add repeatable job — runs every intervalMs
  await bullmqQueue.add(
    'scan-hearings',
    { triggeredBy: 'scheduler' },
    {
      repeat: { every: intervalMs },
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 20 },
    }
  );

  // Create BullMQ Worker to process the job
  bullmqWorker = new Worker(
    'hearing-reminders',
    async (job) => {
      logger.info(`📋 BullMQ job ${job.id} — running hearing reminder scan...`);
      const summary = await runHearingReminderScan();
      return summary;
    },
    {
      connection,
      concurrency: 1,
    }
  );

  bullmqWorker.on('completed', (job, result) => {
    logger.info(`✅ BullMQ hearing reminder job ${job.id} completed — ${result.alerts_created} alerts created`);
  });

  bullmqWorker.on('failed', (job, err) => {
    logger.error({ err }, `❌ BullMQ hearing reminder job ${job?.id} failed`);
  });

  logger.info(`🔔 BullMQ hearing reminder scheduler started (interval: ${(intervalMs / 3600000).toFixed(1)}h)`);

  // Run initial scan after short delay
  setTimeout(async () => {
    try {
      await runHearingReminderScan();
    } catch (err) {
      logger.error({ err }, 'Initial hearing reminder scan failed');
    }
  }, 15000); // Stagger 15s after server start (delay detection starts at 10s)
}

// ============================================================
// setInterval-based Scheduler (fallback for in-memory Redis)
// ============================================================

/**
 * Start hearing reminders using setInterval.
 * Used when BullMQ is not available (in-memory Redis).
 */
function startFallbackScheduler(intervalMs) {
  logger.info(`🔔 Fallback hearing reminder scheduler started (interval: ${(intervalMs / 3600000).toFixed(1)}h)`);

  // Run first scan after short delay
  setTimeout(async () => {
    try {
      await runHearingReminderScan();
    } catch (err) {
      logger.error({ err }, 'Initial hearing reminder scan failed');
    }
  }, 15000);

  // Schedule repeating scans
  fallbackInterval = setInterval(async () => {
    try {
      await runHearingReminderScan();
    } catch (err) {
      logger.error({ err }, 'Scheduled hearing reminder scan failed');
    }
  }, intervalMs);
}

// ============================================================
// Public API: Start / Stop
// ============================================================

/**
 * Start the hearing reminder scheduler.
 * Uses BullMQ if real Redis is available, otherwise falls back to setInterval.
 *
 * @param {number} intervalMs - Interval between scans (default: 1 hour)
 */
async function startHearingReminderScheduler(intervalMs = 60 * 60 * 1000) {
  if (!isMemoryStore()) {
    try {
      await startBullMQScheduler(intervalMs);
      return;
    } catch (err) {
      logger.warn({ err }, '⚠️ BullMQ setup failed for hearing reminders — falling back to setInterval');
    }
  }

  startFallbackScheduler(intervalMs);
}

/**
 * Stop the hearing reminder scheduler.
 * Called during graceful shutdown.
 */
async function stopHearingReminderScheduler() {
  if (bullmqWorker) {
    await bullmqWorker.close();
    bullmqWorker = null;
    logger.info('🔔 BullMQ hearing reminder worker stopped');
  }
  if (bullmqQueue) {
    await bullmqQueue.close();
    bullmqQueue = null;
    logger.info('🔔 BullMQ hearing reminder queue closed');
  }
  if (fallbackInterval) {
    clearInterval(fallbackInterval);
    fallbackInterval = null;
    logger.info('🔔 Fallback hearing reminder scheduler stopped');
  }
}

module.exports = {
  runHearingReminderScan,
  startHearingReminderScheduler,
  stopHearingReminderScheduler,
  REMINDER_WINDOWS,
};
