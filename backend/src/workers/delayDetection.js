// ============================================================
// Delay Detection Worker (BullMQ + setInterval fallback)
// ============================================================
// Scans all active cases and detects delays based on
// how long since the last update (last_update field).
//
// Thresholds:
//   30+ days → warning    (delay_risk_score 3–5)
//   60+ days → high risk  (delay_risk_score 6–8)
//   90+ days → critical   (delay_risk_score 9–10)
//
// Actions:
//   1. Updates delay_risk_score in MongoDB
//   2. Sets stagnation_flag if score >= 9
//   3. Adds case IDs to Redis delay sets
//   4. Creates Alert entries for affected victims
//
// Scheduling:
//   - Uses BullMQ repeatable job when real Redis is available
//   - Falls back to setInterval when using in-memory Redis
//   - Default interval: every 6 hours
// ============================================================
const Case = require('../models/Case');
const Alert = require('../models/Alert');
const { getRedis, isMemoryStore } = require('../config/redis');
const { syncCaseToRedis } = require('../utils/caseCache');
const logger = require('../utils/logger');

// ── Thresholds (in days) ──
const THRESHOLDS = {
  WARNING:  { days: 30, minScore: 3, maxScore: 5, alertType: 'delay_warning',   severity: 'medium' },
  HIGH:     { days: 60, minScore: 6, maxScore: 8, alertType: 'delay_high_risk', severity: 'high' },
  CRITICAL: { days: 90, minScore: 9, maxScore: 10, alertType: 'delay_critical', severity: 'critical' },
};

// Track scheduler handles so we can stop on shutdown
let bullmqWorker = null;
let bullmqQueue = null;
let fallbackInterval = null;

/**
 * Calculate delay risk score based on days since last update.
 * Returns { score, level, threshold } or null if no delay.
 */
function calculateDelayRisk(daysSinceUpdate) {
  if (daysSinceUpdate >= THRESHOLDS.CRITICAL.days) {
    // Map 90-180+ days to score 9-10
    const score = Math.min(10, 9 + (daysSinceUpdate - 90) / 90);
    return { score: parseFloat(score.toFixed(1)), level: 'CRITICAL', threshold: THRESHOLDS.CRITICAL };
  }
  if (daysSinceUpdate >= THRESHOLDS.HIGH.days) {
    // Map 60-89 days to score 6-8
    const score = 6 + ((daysSinceUpdate - 60) / 30) * 2;
    return { score: parseFloat(Math.min(8, score).toFixed(1)), level: 'HIGH', threshold: THRESHOLDS.HIGH };
  }
  if (daysSinceUpdate >= THRESHOLDS.WARNING.days) {
    // Map 30-59 days to score 3-5
    const score = 3 + ((daysSinceUpdate - 30) / 30) * 2;
    return { score: parseFloat(Math.min(5, score).toFixed(1)), level: 'WARNING', threshold: THRESHOLDS.WARNING };
  }
  return null; // No delay detected
}

/**
 * Run the delay detection scan on all active cases.
 * This is the main worker function.
 *
 * @returns {Object} Summary of results
 */
async function runDelayDetection() {
  const startTime = Date.now();
  logger.info('⏱️ Delay detection scan starting...');

  const redis = getRedis();
  const now = new Date();

  // Counters
  let scanned = 0;
  let warnings = 0;
  let highRisk = 0;
  let critical = 0;
  let alertsCreated = 0;
  let updated = 0;

  try {
    // Fetch all active (non-disposed) cases
    const activeCases = await Case.find({
      current_status: { $nin: ['disposed', 'judgment'] },
    }).select('_id cnr_number last_update delay_risk_score stagnation_flag victim_user court current_status adjournment_count').lean();

    scanned = activeCases.length;
    logger.info(`📊 Scanning ${scanned} active cases...`);

    // Clear old delay sets before rebuilding
    await redis.del('delay:warning');
    await redis.del('delay:high_risk');
    await redis.del('delay:critical');

    for (const c of activeCases) {
      const lastUpdate = new Date(c.last_update || c.createdAt);
      const daysSinceUpdate = Math.floor((now - lastUpdate) / (1000 * 60 * 60 * 24));

      const risk = calculateDelayRisk(daysSinceUpdate);

      if (risk) {
        const caseId = c._id.toString();
        const oldScore = c.delay_risk_score || 0;

        // Only update if score has changed significantly (avoid unnecessary writes)
        const scoreChanged = Math.abs(risk.score - oldScore) >= 0.5;

        if (scoreChanged) {
          // Update MongoDB
          const updateData = {
            delay_risk_score: risk.score,
            stagnation_flag: risk.score >= 9,
          };
          await Case.findByIdAndUpdate(c._id, updateData);
          updated++;

          // Sync to Redis
          await syncCaseToRedis({ ...c, ...updateData });
        }

        // Add to Redis delay sets
        if (risk.level === 'WARNING') {
          await redis.sadd('delay:warning', caseId);
          warnings++;
        } else if (risk.level === 'HIGH') {
          await redis.sadd('delay:high_risk', caseId);
          highRisk++;
        } else if (risk.level === 'CRITICAL') {
          await redis.sadd('delay:critical', caseId);
          critical++;
        }

        // Create alert if score crossed a threshold boundary
        if (scoreChanged && c.victim_user) {
          const alreadyAlerted = await Alert.findOne({
            case: c._id,
            alert_type: risk.threshold.alertType,
            createdAt: { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) }, // Don't spam — max 1 per week per type
          });

          if (!alreadyAlerted) {
            await Alert.create({
              case: c._id,
              user: c.victim_user,
              alert_type: risk.threshold.alertType,
              alert_title: `${risk.level} Delay Alert — ${c.cnr_number}`,
              alert_message: buildAlertMessage(c, daysSinceUpdate, risk),
              severity: risk.threshold.severity,
            });
            alertsCreated++;
          }
        }
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    const summary = {
      scanned,
      updated,
      warnings,
      highRisk,
      critical,
      alertsCreated,
      elapsed_seconds: parseFloat(elapsed),
      timestamp: now.toISOString(),
    };

    logger.info('═══════════════════════════════════════════════════');
    logger.info('  ⏱️  Delay Detection Scan Complete');
    logger.info(`     Scanned:  ${scanned} active cases`);
    logger.info(`     Updated:  ${updated} risk scores`);
    logger.info(`     ⚠️  Warning:  ${warnings}`);
    logger.info(`     🔴 High Risk: ${highRisk}`);
    logger.info(`     🚨 Critical:  ${critical}`);
    logger.info(`     🔔 Alerts:    ${alertsCreated} created`);
    logger.info(`     ⏱️  Time:      ${elapsed}s`);
    logger.info('═══════════════════════════════════════════════════');

    return summary;
  } catch (err) {
    logger.error({ err }, '❌ Delay detection scan failed');
    throw err;
  }
}

/**
 * Build a human-readable alert message.
 */
function buildAlertMessage(caseData, daysSinceUpdate, risk) {
  const messages = {
    WARNING: `Your case ${caseData.cnr_number} has had no updates for ${daysSinceUpdate} days. Delay risk score: ${risk.score}/10. This may indicate slow proceedings. Please check with your advocate or court registry.`,
    HIGH: `⚠️ Your case ${caseData.cnr_number} has had no updates for ${daysSinceUpdate} days. Delay risk is HIGH (${risk.score}/10). The case may be stalling. Consider filing an application for next date or contacting the court.`,
    CRITICAL: `🚨 CRITICAL: Your case ${caseData.cnr_number} has had no updates for ${daysSinceUpdate} days! Delay risk: ${risk.score}/10. The case appears stagnant. Immediate action recommended — contact your advocate, file an application, or reach out to legal aid (NALSA).`,
  };
  return messages[risk.level] || messages.WARNING;
}

// ============================================================
// BullMQ-based Scheduler (real Redis)
// ============================================================

/**
 * Start delay detection using BullMQ repeatable job.
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

  // If using a URL-based connection (Upstash), extract from redis options
  if (redis.options?.connectionName || redis.options?.tls) {
    connection.tls = redis.options.tls || {};
  }

  // Create BullMQ Queue
  bullmqQueue = new Queue('delay-detection', { connection });

  // Remove any existing repeatable jobs (avoid duplicates on restart)
  const existingJobs = await bullmqQueue.getRepeatableJobs();
  for (const job of existingJobs) {
    await bullmqQueue.removeRepeatableByKey(job.key);
  }

  // Add repeatable job — runs every intervalMs
  await bullmqQueue.add(
    'scan-delays',
    { triggeredBy: 'scheduler' },
    {
      repeat: { every: intervalMs },
      removeOnComplete: { count: 10 },  // Keep last 10 completed jobs
      removeOnFail: { count: 20 },       // Keep last 20 failed jobs
    }
  );

  // Create BullMQ Worker to process the job
  bullmqWorker = new Worker(
    'delay-detection',
    async (job) => {
      logger.info(`📋 BullMQ job ${job.id} — running delay detection scan...`);
      const summary = await runDelayDetection();
      return summary;
    },
    {
      connection,
      concurrency: 1,  // Only 1 scan at a time
    }
  );

  bullmqWorker.on('completed', (job, result) => {
    logger.info(`✅ BullMQ job ${job.id} completed — scanned ${result.scanned} cases`);
  });

  bullmqWorker.on('failed', (job, err) => {
    logger.error({ err }, `❌ BullMQ job ${job?.id} failed`);
  });

  logger.info(`⏱️ BullMQ delay detection scheduler started (interval: ${(intervalMs / 3600000).toFixed(1)}h)`);

  // Run initial scan after short delay
  setTimeout(async () => {
    try {
      await runDelayDetection();
    } catch (err) {
      logger.error({ err }, 'Initial delay detection scan failed');
    }
  }, 10000);
}

// ============================================================
// setInterval-based Scheduler (fallback for in-memory Redis)
// ============================================================

/**
 * Start delay detection using setInterval.
 * Used when BullMQ is not available (in-memory Redis).
 */
function startFallbackScheduler(intervalMs) {
  logger.info(`⏱️ Fallback delay detection scheduler started (interval: ${(intervalMs / 3600000).toFixed(1)}h)`);

  // Run first scan after a short delay (let server fully start)
  setTimeout(async () => {
    try {
      await runDelayDetection();
    } catch (err) {
      logger.error({ err }, 'Initial delay detection scan failed');
    }
  }, 10000);

  // Schedule repeating scans
  fallbackInterval = setInterval(async () => {
    try {
      await runDelayDetection();
    } catch (err) {
      logger.error({ err }, 'Scheduled delay detection scan failed');
    }
  }, intervalMs);
}

// ============================================================
// Public API: Start / Stop
// ============================================================

/**
 * Start the delay detection scheduler.
 * Uses BullMQ if real Redis is available, otherwise falls back to setInterval.
 *
 * @param {number} intervalMs - Interval between scans (default: 6 hours)
 */
async function startDelayDetectionScheduler(intervalMs = 6 * 60 * 60 * 1000) {
  if (!isMemoryStore()) {
    // Real Redis available → use BullMQ
    try {
      await startBullMQScheduler(intervalMs);
      return;
    } catch (err) {
      logger.warn({ err }, '⚠️ BullMQ setup failed — falling back to setInterval');
    }
  }

  // Fallback: use setInterval (works with in-memory Redis too)
  startFallbackScheduler(intervalMs);
}

/**
 * Stop the delay detection scheduler.
 * Called during graceful shutdown.
 */
async function stopDelayDetectionScheduler() {
  // Stop BullMQ worker + queue
  if (bullmqWorker) {
    await bullmqWorker.close();
    bullmqWorker = null;
    logger.info('⏱️ BullMQ delay detection worker stopped');
  }
  if (bullmqQueue) {
    await bullmqQueue.close();
    bullmqQueue = null;
    logger.info('⏱️ BullMQ delay detection queue closed');
  }

  // Stop fallback interval
  if (fallbackInterval) {
    clearInterval(fallbackInterval);
    fallbackInterval = null;
    logger.info('⏱️ Fallback delay detection scheduler stopped');
  }
}

module.exports = {
  runDelayDetection,
  calculateDelayRisk,
  startDelayDetectionScheduler,
  stopDelayDetectionScheduler,
  THRESHOLDS,
};
