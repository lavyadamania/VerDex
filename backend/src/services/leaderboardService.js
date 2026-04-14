// ============================================================
// Leaderboard & Analytics Computation Service
// ============================================================
// Computes court performance rankings based on:
//   1. Cases resolved count
//   2. Average resolution time (days)
//   3. Adjournment rate (avg adjournments per case)
//   4. Backlog size (pending cases)
//   5. Lifecycle completion score (start -> end progression)
//   6. Justice Speed Index (composite score 0–100)
//
// Rankings are stored in Redis sorted sets for fast retrieval.
// ============================================================
const Case = require('../models/Case');
const Court = require('../models/Court');
const { getRedis } = require('../config/redis');
const logger = require('../utils/logger');
const { computeDelayRisk } = require('../utils/delayRisk');
const { updateCourtMapData, invalidateMapCache } = require('./courtMapService');
const { publishRealtimeEvent } = require('./eventPublisher');

// Redis key constants
const REDIS_KEYS = {
  LEADERBOARD: 'leaderboard:courts',           // Sorted set by JSI score
  COURT_METRICS: (id) => `leaderboard:court:${id}`, // Hash per court
  LAST_REFRESH: 'leaderboard:last_refresh',
  SYSTEM_STATS: 'leaderboard:system_stats',
};

/**
 * Compute all court metrics and rankings.
 * This is the main computation function called by the refresh worker.
 *
 * @returns {Object} { courts: [...], systemStats: {...}, elapsed }
 */
async function computeLeaderboard() {
  const startTime = Date.now();
  logger.info('📊 Leaderboard computation starting...');

  const redis = getRedis();

  try {
    // Clear stale leaderboard cache to avoid mixing old and current court IDs.
    await redis.del(REDIS_KEYS.LEADERBOARD);
    const staleMetricKeys = await redis.keys('leaderboard:court:*');
    if (staleMetricKeys.length > 0) {
      await redis.del(...staleMetricKeys);
    }

    // Get all courts
    const courts = await Court.find().lean();

    if (courts.length === 0) {
      logger.warn('No courts found — skipping leaderboard computation');
      return { courts: [], systemStats: {}, elapsed: 0 };
    }

    // Run aggregation pipeline for all courts at once
    const [
      courtCaseStats,
      courtResolutionTimes,
      courtAdjournments,
      courtDelayStats,
    ] = await Promise.all([
      // 1. Case counts by status per court
      Case.aggregate([
        {
          $group: {
            _id: { court: '$court', status: '$current_status' },
            count: { $sum: 1 },
          },
        },
      ]),

      // 2. Average resolution time for disposed cases per court
      Case.aggregate([
        { $match: { current_status: { $in: ['disposed', 'judgment'] } } },
        {
          $project: {
            court: 1,
            resolution_days: {
              $divide: [
                { $subtract: ['$updatedAt', '$filing_date'] },
                1000 * 60 * 60 * 24, // ms to days
              ],
            },
          },
        },
        {
          $group: {
            _id: '$court',
            avg_resolution_days: { $avg: '$resolution_days' },
            min_resolution_days: { $min: '$resolution_days' },
            max_resolution_days: { $max: '$resolution_days' },
            resolved_count: { $sum: 1 },
          },
        },
      ]),

      // 3. Average adjournment count per court
      Case.aggregate([
        {
          $group: {
            _id: '$court',
            avg_adjournments: { $avg: '$adjournment_count' },
            total_adjournments: { $sum: '$adjournment_count' },
            total_hearings: { $sum: '$total_hearings' },
            case_count: { $sum: 1 },
          },
        },
      ]),

      // 4. Delay risk stats per court
      Case.aggregate([
        { $match: { current_status: { $nin: ['disposed', 'judgment'] } } },
        {
          $group: {
            _id: '$court',
            avg_delay_score: { $avg: '$delay_risk_score' },
            stagnant_count: { $sum: { $cond: ['$stagnation_flag', 1, 0] } },
            high_risk_count: {
              $sum: { $cond: [{ $gte: ['$delay_risk_score', 6] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    // Build lookup maps
    const caseStatsMap = {};
    for (const stat of courtCaseStats) {
      const courtId = stat._id.court?.toString();
      if (!courtId) continue;
      if (!caseStatsMap[courtId]) caseStatsMap[courtId] = {};
      caseStatsMap[courtId][stat._id.status] = stat.count;
    }

    const resolutionMap = {};
    for (const r of courtResolutionTimes) {
      resolutionMap[r._id.toString()] = r;
    }

    const adjournmentMap = {};
    for (const a of courtAdjournments) {
      adjournmentMap[a._id.toString()] = a;
    }

    const delayMap = {};
    for (const d of courtDelayStats) {
      delayMap[d._id.toString()] = d;
    }

    // Compute metrics for each court
    const courtMetrics = [];

    for (const court of courts) {
      const courtId = court._id.toString();
      const statusCounts = caseStatsMap[courtId] || {};
      const resolution = resolutionMap[courtId] || {};
      const adjournment = adjournmentMap[courtId] || {};
      const delay = delayMap[courtId] || {};

      // Case counts
      const totalFiled = Object.values(statusCounts).reduce((s, c) => s + c, 0);
      const resolved = (statusCounts.disposed || 0) + (statusCounts.judgment || 0);
      const pending = totalFiled - resolved;

      // Resolution rate (0–100)
      const resolutionRate = totalFiled > 0 ? (resolved / totalFiled) * 100 : 0;

      // Average resolution time (days) — lower is better
      const avgResolutionDays = resolution.avg_resolution_days || 0;

      // Adjournment rate — lower is better
      const avgAdjournments = adjournment.avg_adjournments || 0;
      const totalCases = adjournment.case_count || 0;

      // Delay metrics
      const avgDelayScore = delay.avg_delay_score || 0;
      const stagnantCount = delay.stagnant_count || 0;

      // ── Lifecycle Completion Score (0-100) ──
      // Measures how far cases move from start (filed) to end states.
      const lifecycleStageWeight = {
        filed: 0.0,
        hearing: 0.2,
        evidence: 0.4,
        arguments: 0.6,
        reserved: 0.75,
        judgment: 0.9,
        disposed: 1.0,
        appealed: 1.0,
      };

      const weightedStageSum = Object.entries(statusCounts).reduce((sum, [stage, count]) => {
        const weight = lifecycleStageWeight[stage] ?? 0;
        return sum + (weight * count);
      }, 0);
      const lifecycleCompletionScore = totalFiled > 0
        ? (weightedStageSum / totalFiled) * 100
        : 0;

      // ── Justice Speed Index (JSI) — Composite Score 0–100 ──
      // Higher is better. Weights:
      //   35% = Resolution rate (higher -> better)
      //   20% = Speed (lower avg resolution time -> better, capped at 365 days)
      //   15% = Low adjournment rate (lower -> better, capped at 10)
      //   15% = Low delay risk (lower avg delay score -> better)
      //   15% = Lifecycle completion (start -> end progression)
      const speedScore = Math.max(0, 100 - (avgResolutionDays / 365) * 100);
      const adjournmentScore = Math.max(0, 100 - (avgAdjournments / 10) * 100);
      const delayScore = Math.max(0, 100 - (avgDelayScore / 10) * 100);

      const jsi = (
        resolutionRate * 0.35 +
        speedScore * 0.20 +
        adjournmentScore * 0.15 +
        delayScore * 0.15 +
        lifecycleCompletionScore * 0.15
      );

      const metrics = {
        court_id: courtId,
        court_name: court.court_name,
        court_type: court.court_type,
        district: court.district,
        state: court.state,
        total_cases_filed: totalFiled,
        cases_resolved: resolved,
        cases_pending: pending,
        resolution_rate: parseFloat(resolutionRate.toFixed(2)),
        avg_resolution_days: parseFloat((avgResolutionDays || 0).toFixed(1)),
        avg_adjournments: parseFloat((avgAdjournments || 0).toFixed(2)),
        avg_delay_score: parseFloat((avgDelayScore || 0).toFixed(2)),
        stagnant_cases: stagnantCount,
        lifecycle_completion_score: parseFloat(lifecycleCompletionScore.toFixed(2)),
        justice_speed_index: parseFloat(jsi.toFixed(2)),
      };

      courtMetrics.push(metrics);

      // Store per-court metrics in Redis hash
      const hashKey = REDIS_KEYS.COURT_METRICS(courtId);
      for (const [field, value] of Object.entries(metrics)) {
        await redis.hset(hashKey, field, String(value));
      }

      // Update Redis sorted set (by JSI score)
      await redis.zadd(REDIS_KEYS.LEADERBOARD, metrics.justice_speed_index, courtId);

      // Also update the Court document counters
      await Court.findByIdAndUpdate(courtId, {
        total_cases_filed: totalFiled,
        total_cases_resolved: resolved,
      });

      // ── Heatmap: compute delay risk & update mapdata ──
      const adjournmentRate = totalCases > 0
        ? parseFloat(((avgAdjournments / (totalCases || 1)) * 100).toFixed(2))
        : 0;

      const delayRisk = computeDelayRisk({
        jsi_score: metrics.justice_speed_index,
        stagnation_count: stagnantCount,
      });

      try {
        await updateCourtMapData(courtId, {
          delay_risk: delayRisk,
          jsi_score: metrics.justice_speed_index,
          pending_cases: pending,
          adjournment_rate: adjournmentRate,
          stagnation_count: stagnantCount,
        });
      } catch (mapErr) {
        logger.error(`[Leaderboard] Map data update failed for ${courtId}: ${mapErr.message}`);
      }
    }

    // Sort by JSI descending and assign ranks
    courtMetrics.sort((a, b) => b.justice_speed_index - a.justice_speed_index);
    courtMetrics.forEach((c, i) => {
      c.rank = i + 1;
    });

    // Compute system-wide stats
    const systemStats = {
      total_courts: courts.length,
      total_cases: courtMetrics.reduce((s, c) => s + c.total_cases_filed, 0),
      total_resolved: courtMetrics.reduce((s, c) => s + c.cases_resolved, 0),
      total_pending: courtMetrics.reduce((s, c) => s + c.cases_pending, 0),
      avg_resolution_rate: parseFloat(
        (courtMetrics.reduce((s, c) => s + c.resolution_rate, 0) / (courts.length || 1)).toFixed(2)
      ),
      avg_jsi: parseFloat(
        (courtMetrics.reduce((s, c) => s + c.justice_speed_index, 0) / (courts.length || 1)).toFixed(2)
      ),
      top_court: courtMetrics[0]?.court_name || 'N/A',
      bottom_court: courtMetrics[courtMetrics.length - 1]?.court_name || 'N/A',
      refreshed_at: new Date().toISOString(),
    };

    // Store system stats in Redis
    for (const [field, value] of Object.entries(systemStats)) {
      await redis.hset(REDIS_KEYS.SYSTEM_STATS, field, String(value));
    }
    await redis.set(REDIS_KEYS.LAST_REFRESH, new Date().toISOString());

    // ── Invalidate heatmap cache so next API call rebuilds fresh ──
    try {
      await invalidateMapCache();
    } catch (cacheErr) {
      logger.error(`[Leaderboard] Map cache invalidation failed: ${cacheErr.message}`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info('═══════════════════════════════════════════════════');
    logger.info('  📊 Leaderboard Refresh Complete');
    logger.info(`     Courts ranked:  ${courts.length}`);
    logger.info(`     Total cases:    ${systemStats.total_cases}`);
    logger.info(`     Avg JSI:        ${systemStats.avg_jsi}`);
    logger.info(`     Top court:      ${systemStats.top_court}`);
    logger.info(`     ⏱️  Time:        ${elapsed}s`);
    logger.info('═══════════════════════════════════════════════════');

    await publishRealtimeEvent('LEADERBOARD_UPDATE', null, {
      courtsRanked: courtMetrics.length,
      topCourt: systemStats.top_court,
      avgJsi: systemStats.avg_jsi,
      rolesVisibleTo: ['visitor', 'victim', 'advocate', 'court_staff', 'admin'],
      message: 'Leaderboard metrics refreshed',
    });

    return { courts: courtMetrics, systemStats, elapsed: parseFloat(elapsed) };
  } catch (err) {
    logger.error({ err }, '❌ Leaderboard computation failed');
    throw err;
  }
}

/**
 * Get leaderboard from Redis (fast read).
 * Falls back to live computation if Redis is empty.
 *
 * @param {Object} options
 * @param {number} options.limit - Max courts to return (default: all)
 * @param {string} options.state - Filter by state (optional)
 * @returns {Object} { leaderboard, systemStats, fromCache }
 */
async function getLeaderboard({ limit = 0, state = null } = {}) {
  const redis = getRedis();

  // Try to get from Redis sorted set
  const courtIds = await redis.zrevrange(
    REDIS_KEYS.LEADERBOARD,
    0,
    limit > 0 ? limit - 1 : -1,
    'WITHSCORES'
  );

  if (!courtIds || courtIds.length === 0) {
    // No cached data — compute fresh
    const result = await computeLeaderboard();
    return { leaderboard: result.courts, systemStats: result.systemStats, fromCache: false };
  }

  // Parse sorted set results (alternating: member, score, member, score...)
  const leaderboard = [];
  for (let i = 0; i < courtIds.length; i += 2) {
    const courtId = courtIds[i];
    const jsi = parseFloat(courtIds[i + 1]);

    // Get full metrics from Redis hash
    const metrics = await redis.hgetall(REDIS_KEYS.COURT_METRICS(courtId));
    if (metrics && Object.keys(metrics).length > 0) {
      leaderboard.push({
        ...metrics,
        justice_speed_index: jsi,
        total_cases_filed: parseInt(metrics.total_cases_filed) || 0,
        cases_resolved: parseInt(metrics.cases_resolved) || 0,
        cases_pending: parseInt(metrics.cases_pending) || 0,
        resolution_rate: parseFloat(metrics.resolution_rate) || 0,
        avg_resolution_days: parseFloat(metrics.avg_resolution_days) || 0,
        avg_adjournments: parseFloat(metrics.avg_adjournments) || 0,
        avg_delay_score: parseFloat(metrics.avg_delay_score) || 0,
        stagnant_cases: parseInt(metrics.stagnant_cases) || 0,
        lifecycle_completion_score: parseFloat(metrics.lifecycle_completion_score) || 0,
      });
    }
  }

  // Assign ranks
  leaderboard.forEach((c, i) => { c.rank = i + 1; });

  // Filter by state if requested
  const filtered = state
    ? leaderboard.filter(c => c.state?.toLowerCase() === state.toLowerCase())
    : leaderboard;

  // Get system stats
  const systemStats = await redis.hgetall(REDIS_KEYS.SYSTEM_STATS) || {};

  return { leaderboard: filtered, systemStats, fromCache: true };
}

/**
 * Get detailed analytics for a specific court.
 *
 * @param {string} courtId
 * @returns {Object} Court metrics + case breakdown
 */
async function getCourtAnalytics(courtId) {
  const redis = getRedis();

  // Try Redis first
  const cached = await redis.hgetall(REDIS_KEYS.COURT_METRICS(courtId));

  // Get live breakdowns from MongoDB
  const [
    statusBreakdown,
    typeBreakdown,
    monthlyTrend,
    topDelayed,
  ] = await Promise.all([
    Case.aggregate([
      { $match: { court: require('mongoose').Types.ObjectId.createFromHexString(courtId) } },
      { $group: { _id: '$current_status', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Case.aggregate([
      { $match: { court: require('mongoose').Types.ObjectId.createFromHexString(courtId) } },
      { $group: { _id: '$case_type', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    // Monthly filing trend (last 12 months)
    Case.aggregate([
      { $match: { court: require('mongoose').Types.ObjectId.createFromHexString(courtId) } },
      {
        $group: {
          _id: {
            year: { $year: '$filing_date' },
            month: { $month: '$filing_date' },
          },
          filed: { $sum: 1 },
          resolved: {
            $sum: {
              $cond: [{ $in: ['$current_status', ['disposed', 'judgment']] }, 1, 0],
            },
          },
        },
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 },
    ]),
    // Top 5 most delayed cases
    Case.find({
      court: courtId,
      current_status: { $nin: ['disposed', 'judgment'] },
    })
      .select('cnr_number case_type delay_risk_score last_update filing_date stagnation_flag')
      .sort({ delay_risk_score: -1 })
      .limit(5)
      .lean(),
  ]);

  return {
    metrics: cached && Object.keys(cached).length > 0 ? cached : null,
    breakdowns: {
      by_status: statusBreakdown.reduce((a, s) => ({ ...a, [s._id]: s.count }), {}),
      by_type: typeBreakdown.reduce((a, t) => ({ ...a, [t._id]: t.count }), {}),
      monthly_trend: monthlyTrend.map(m => ({
        year: m._id.year,
        month: m._id.month,
        filed: m.filed,
        resolved: m.resolved,
      })),
    },
    top_delayed_cases: topDelayed,
  };
}

module.exports = {
  computeLeaderboard,
  getLeaderboard,
  getCourtAnalytics,
  REDIS_KEYS,
};
