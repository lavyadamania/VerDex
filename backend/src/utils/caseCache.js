// ============================================================
// Case Cache — Redis Sync Utility
// ============================================================
// Syncs case state and court stats to Redis after every write
// so that dashboards can read real-time data without hitting
// MongoDB on every request.
//
// Redis Key Schema:
//   case:{id}:info          → Hash   (status, last_update, next_hearing, etc.)
//   court:{id}:stats        → Hash   (pending_cases, disposed_cases, delay_score)
//   delay:warning           → Set    (case IDs with 30+ days no update)
//   delay:high_risk         → Set    (case IDs with 60+ days no update)
//   delay:critical          → Set    (case IDs with 90+ days no update)
//   leaderboard:courts      → Sorted Set (court_id by resolution_rate)
// ============================================================
const { getRedis } = require('../config/redis');
const Case = require('../models/Case');
const Court = require('../models/Court');
const logger = require('./logger');
const { publishToUser } = require('../services/eventPublisher');

/**
 * Sync a single case's key fields to Redis.
 * Called after case create, update, status change, or event add.
 *
 * @param {Object} caseDoc - Mongoose case document (or plain object with _id)
 */
async function syncCaseToRedis(caseDoc) {
  try {
    const redis = getRedis();
    const caseId = caseDoc._id.toString();
    const key = `case:${caseId}:info`;

    // Build hash data
    const data = {
      status: caseDoc.current_status || '',
      last_update: caseDoc.last_update ? new Date(caseDoc.last_update).toISOString() : '',
      next_hearing: caseDoc.next_hearing_date ? new Date(caseDoc.next_hearing_date).toISOString() : '',
      adjournment_count: String(caseDoc.adjournment_count || 0),
      total_hearings: String(caseDoc.total_hearings || 0),
      delay_risk_score: String(caseDoc.delay_risk_score || 0),
      stagnation_flag: String(caseDoc.stagnation_flag || false),
      case_type: caseDoc.case_type || '',
      court_id: caseDoc.court ? caseDoc.court.toString() : '',
      filing_date: caseDoc.filing_date ? new Date(caseDoc.filing_date).toISOString() : '',
      disclosure_mode: caseDoc.disclosure_mode || 'private',
    };

    // Write all fields to Redis hash
    for (const [field, value] of Object.entries(data)) {
      await redis.hset(key, field, value);
    }

    // Also set individual top-level keys for quick lookups
    await redis.set(`case:${caseId}:status`, data.status);
    await redis.set(`case:${caseId}:last_update`, data.last_update);
    if (data.next_hearing) {
      await redis.set(`case:${caseId}:next_hearing`, data.next_hearing);
    }
    await redis.set(`case:${caseId}:adjournment_count`, data.adjournment_count);

    // Update delay risk sets
    await updateDelayRiskSets(caseId, caseDoc);

    logger.info(`[SYNC] Redis synced: case:${caseId} -> status=${data.status}`);

    // ── Publish real-time case update via Pub/Sub ──
    if (caseDoc.victim_user) {
      publishToUser(caseDoc.victim_user, 'case_update', {
        caseId,
        cnr_number: caseDoc.cnr_number || '',
        status: data.status,
        next_hearing: data.next_hearing,
        delay_risk_score: data.delay_risk_score,
      }).catch(() => {}); // Fire-and-forget
    }
  } catch (err) {
    // Never break the request if Redis sync fails
    logger.error({ err }, `Failed to sync case ${caseDoc._id} to Redis`);
  }
}

/**
 * Update delay risk sorted sets based on case state.
 * Moves case IDs between warning/high_risk/critical sets.
 */
async function updateDelayRiskSets(caseId, caseDoc) {
  const redis = getRedis();
  const score = parseFloat(caseDoc.delay_risk_score) || 0;

  // Remove from all delay sets first
  await redis.srem('delay:warning', caseId);
  await redis.srem('delay:high_risk', caseId);
  await redis.srem('delay:critical', caseId);

  // Skip disposed cases
  if (caseDoc.current_status === 'disposed') return;

  // Categorize by score
  if (score >= 9) {
    await redis.sadd('delay:critical', caseId);
  } else if (score >= 6) {
    await redis.sadd('delay:high_risk', caseId);
  } else if (score >= 3) {
    await redis.sadd('delay:warning', caseId);
  }
}

/**
 * Recalculate and sync court aggregate stats to Redis.
 * Called after case create, dispose, or delete.
 *
 * @param {string} courtId - MongoDB court _id
 */
async function syncCourtStatsToRedis(courtId) {
  try {
    const redis = getRedis();
    const courtIdStr = courtId.toString();
    const key = `court:${courtIdStr}:stats`;

    // Aggregate from MongoDB
    const [pendingCount, disposedCount, delayAgg] = await Promise.all([
      Case.countDocuments({ court: courtId, current_status: { $ne: 'disposed' } }),
      Case.countDocuments({ court: courtId, current_status: 'disposed' }),
      Case.aggregate([
        { $match: { court: courtId, current_status: { $ne: 'disposed' } } },
        { $group: { _id: null, avg_delay: { $avg: '$delay_risk_score' } } },
      ]),
    ]);

    const avgDelay = delayAgg[0]?.avg_delay?.toFixed(2) || '0';

    await redis.hset(key, 'pending_cases', String(pendingCount));
    await redis.hset(key, 'disposed_cases', String(disposedCount));
    await redis.hset(key, 'delay_score', avgDelay);

    // Also set individual keys (per spec)
    const court = await Court.findById(courtId).lean();
    const courtName = court ? court.court_name.replace(/\s+/g, '_').toLowerCase() : courtIdStr;
    await redis.set(`court:${courtName}:pending_cases`, String(pendingCount));
    await redis.set(`court:${courtName}:disposed_cases`, String(disposedCount));
    await redis.set(`court:${courtName}:delay_score`, avgDelay);

    // Update leaderboard sorted set
    const totalFiled = pendingCount + disposedCount;
    const resolutionRate = totalFiled > 0 ? (disposedCount / totalFiled) * 100 : 0;
    await redis.zadd('leaderboard:courts', resolutionRate, courtIdStr);

    logger.info(`[SYNC] Redis synced: court:${courtIdStr} -> pending=${pendingCount}, disposed=${disposedCount}, delay=${avgDelay}`);
  } catch (err) {
    logger.error({ err }, `Failed to sync court ${courtId} stats to Redis`);
  }
}

/**
 * Read cached case state from Redis (fast dashboard read).
 *
 * @param {string} caseId
 * @returns {Object|null} cached case info or null
 */
async function getCachedCaseState(caseId) {
  try {
    const redis = getRedis();
    const data = await redis.hgetall(`case:${caseId}:info`);
    if (!data || Object.keys(data).length === 0) return null;
    return data;
  } catch (err) {
    logger.error({ err }, `Failed to read cached state for case ${caseId}`);
    return null;
  }
}

/**
 * Read cached court stats from Redis.
 *
 * @param {string} courtId
 * @returns {Object|null}
 */
async function getCachedCourtStats(courtId) {
  try {
    const redis = getRedis();
    const data = await redis.hgetall(`court:${courtId}:stats`);
    if (!data || Object.keys(data).length === 0) return null;
    return data;
  } catch (err) {
    logger.error({ err }, `Failed to read cached stats for court ${courtId}`);
    return null;
  }
}

/**
 * Delete cached case data from Redis (on soft-delete).
 *
 * @param {string} caseId
 */
async function deleteCaseCache(caseId) {
  try {
    const redis = getRedis();
    const caseIdStr = caseId.toString();

    await redis.del(`case:${caseIdStr}:info`);
    await redis.del(`case:${caseIdStr}:status`);
    await redis.del(`case:${caseIdStr}:last_update`);
    await redis.del(`case:${caseIdStr}:next_hearing`);
    await redis.del(`case:${caseIdStr}:adjournment_count`);

    // Remove from delay sets
    await redis.srem('delay:warning', caseIdStr);
    await redis.srem('delay:high_risk', caseIdStr);
    await redis.srem('delay:critical', caseIdStr);

    logger.info(`🗑️ Redis cache cleared: case:${caseIdStr}`);
  } catch (err) {
    logger.error({ err }, `Failed to delete cache for case ${caseId}`);
  }
}

/**
 * Bulk sync all cases from MongoDB to Redis.
 * Useful after seeding or for initial cache population.
 */
async function bulkSyncAllCasesToRedis() {
  try {
    const cases = await Case.find().lean();
    logger.info(`🔄 Bulk syncing ${cases.length} cases to Redis...`);

    for (const c of cases) {
      await syncCaseToRedis(c);
    }

    // Sync all court stats
    const courts = await Court.find().lean();
    for (const court of courts) {
      await syncCourtStatsToRedis(court._id);
    }

    logger.info(`✅ Bulk sync complete: ${cases.length} cases, ${courts.length} courts`);
  } catch (err) {
    logger.error({ err }, 'Bulk sync to Redis failed');
  }
}

module.exports = {
  syncCaseToRedis,
  syncCourtStatsToRedis,
  getCachedCaseState,
  getCachedCourtStats,
  deleteCaseCache,
  bulkSyncAllCasesToRedis,
};
