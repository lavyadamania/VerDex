// ============================================================
// Court Map Service — Redis Geo Layer & Map Data Provider
// ============================================================
// Manages the geographical indexing of courts in Redis and
// provides data for the Snapchat-style delay heatmap.
//
// Redis structures used:
//   GEOADD  courts:geo <lng> <lat> <court_id>
//   HSET    court:<court_id>:mapdata { delay_risk, jsi_score, ... }
//   SET     map:courts:all (cached JSON, TTL 60s)
// ============================================================
const Court = require('../models/Court');
const Case = require('../models/Case');
const { getRedis } = require('../config/redis');
const { computeDelayRisk, riskColor, riskSeverity } = require('../utils/delayRisk');
const logger = require('../utils/logger');

// ── Redis Key Constants ──
const MAP_KEYS = {
  GEO_INDEX: 'courts:geo',
  COURT_MAPDATA: (id) => `court:${id}:mapdata`,
  MAP_CACHE: 'map:courts:all',
  MAP_CACHE_TTL: 60, // seconds
};

// ============================================================
// GEOADD — Register court coordinates in Redis Geo index
// ============================================================

/**
 * Add a single court's coordinates to the Redis geo index.
 *
 * @param {string} courtId
 * @param {number} lng — Longitude
 * @param {number} lat — Latitude
 */
async function geoAddCourt(courtId, lng, lat) {
  const redis = getRedis();
  try {
    await redis.geoadd(MAP_KEYS.GEO_INDEX, lng, lat, courtId);
  } catch (err) {
    logger.error(`[CourtMapService] GEOADD failed for court ${courtId}: ${err.message}`);
  }
}

/**
 * Bulk register all courts with lat/lng into the Redis geo index.
 * Called on seed and on application startup.
 */
async function geoAddAllCourts() {
  const redis = getRedis();
  try {
    const courts = await Court.find({ lat: { $exists: true }, lng: { $exists: true } }).lean();
    if (courts.length === 0) {
      logger.warn('[CourtMapService] No courts with lat/lng found — geo index empty');
      return 0;
    }

    let added = 0;
    for (const court of courts) {
      try {
        await redis.geoadd(MAP_KEYS.GEO_INDEX, court.lng, court.lat, court._id.toString());
        added++;
      } catch (err) {
        logger.error(`[CourtMapService] GEOADD failed for ${court.court_name}: ${err.message}`);
      }
    }

    logger.info(`[CourtMapService] ✅ Geo-indexed ${added}/${courts.length} courts`);
    return added;
  } catch (err) {
    logger.error(`[CourtMapService] geoAddAllCourts failed: ${err.message}`);
    return 0;
  }
}

// ============================================================
// HSET — Store/update per-court map metadata in Redis hash
// ============================================================

/**
 * Update the mapdata hash for a single court.
 *
 * @param {string} courtId
 * @param {Object} data — { delay_risk, jsi_score, pending_cases, adjournment_rate, stagnation_count }
 */
async function updateCourtMapData(courtId, data) {
  const redis = getRedis();
  const key = MAP_KEYS.COURT_MAPDATA(courtId);
  try {
    const fields = {
      delay_risk: data.delay_risk || 'LOW',
      jsi_score: String(data.jsi_score ?? 0),
      pending_cases: String(data.pending_cases ?? 0),
      adjournment_rate: String(data.adjournment_rate ?? 0),
      stagnation_count: String(data.stagnation_count ?? 0),
      risk_color: riskColor(data.delay_risk || 'LOW'),
      risk_severity: String(riskSeverity(data.delay_risk || 'LOW')),
      updated_at: new Date().toISOString(),
    };

    for (const [field, value] of Object.entries(fields)) {
      await redis.hset(key, field, value);
    }
  } catch (err) {
    logger.error(`[CourtMapService] updateCourtMapData failed for ${courtId}: ${err.message}`);
  }
}

// ============================================================
// Invalidate map cache (called after leaderboard refresh)
// ============================================================

/**
 * Delete the cached map response so the next API call rebuilds it.
 */
async function invalidateMapCache() {
  const redis = getRedis();
  try {
    await redis.del(MAP_KEYS.MAP_CACHE);
    logger.info('[CourtMapService] 🗑️  Map cache invalidated');
  } catch (err) {
    logger.error(`[CourtMapService] Cache invalidation failed: ${err.message}`);
  }
}

// ============================================================
// GET MAP DATA — For the /api/courts/map endpoint
// ============================================================

/**
 * Retrieve all court map data. Checks Redis cache first, falls
 * back to MongoDB if cache miss or Redis error.
 *
 * BNS Section 72 compliance: victim_count is never exposed as
 * individual identifiers — only aggregated numbers are returned.
 *
 * @param {Object} [options]
 * @param {string} [options.state] — Filter by state
 * @param {string} [options.risk]  — Filter by delay_risk level
 * @returns {Object} { courts: [...], fromCache: boolean, total: number }
 */
async function getMapData(options = {}) {
  const redis = getRedis();

  // ── Try Redis cache first ──
  try {
    const cached = await redis.get(MAP_KEYS.MAP_CACHE);
    if (cached) {
      let courts = JSON.parse(cached);

      // Apply in-memory filters on cached data
      if (options.state) {
        courts = courts.filter(c => c.state?.toLowerCase() === options.state.toLowerCase());
      }
      if (options.risk) {
        courts = courts.filter(c => c.delay_risk === options.risk.toUpperCase());
      }

      logger.info(`[CourtMapService] Cache HIT — returning ${courts.length} courts`);
      return { courts, fromCache: true, total: courts.length };
    }
  } catch (err) {
    logger.error(`[CourtMapService] Redis cache read failed: ${err.message}`);
    // Fall through to MongoDB
  }

  // ── Cache miss → build from MongoDB ──
  logger.info('[CourtMapService] Cache MISS — querying MongoDB');

  try {
    const courts = await Court.find({
      lat: { $exists: true, $ne: null },
      lng: { $exists: true, $ne: null },
    }).lean();

    if (courts.length === 0) {
      return { courts: [], fromCache: false, total: 0 };
    }

    // Get case metrics (aggregated — BNS Section 72 compliant)
    const courtIds = courts.map(c => c._id);
    const [caseAggregation, delayAggregation] = await Promise.all([
      Case.aggregate([
        { $match: { court: { $in: courtIds } } },
        {
          $group: {
            _id: '$court',
            total_cases: { $sum: 1 },
            pending_cases: {
              $sum: {
                $cond: [
                  { $not: { $in: ['$current_status', ['disposed', 'judgment']] } },
                  1, 0
                ],
              },
            },
            resolved_cases: {
              $sum: {
                $cond: [
                  { $in: ['$current_status', ['disposed', 'judgment']] },
                  1, 0
                ],
              },
            },
            total_adjournments: { $sum: '$adjournment_count' },
            total_hearings: { $sum: '$total_hearings' },
            stagnant_count: { $sum: { $cond: ['$stagnation_flag', 1, 0] } },
            avg_delay_score: { $avg: '$delay_risk_score' },
          },
        },
      ]),
      Case.aggregate([
        { $match: { court: { $in: courtIds }, current_status: { $nin: ['disposed', 'judgment'] } } },
        {
          $group: {
            _id: '$court',
            high_risk_count: { $sum: { $cond: [{ $gte: ['$delay_risk_score', 6] }, 1, 0] } },
          },
        },
      ]),
    ]);

    // Build lookup maps
    const caseMap = {};
    for (const c of caseAggregation) {
      caseMap[c._id.toString()] = c;
    }
    const delayMap = {};
    for (const d of delayAggregation) {
      delayMap[d._id.toString()] = d;
    }

    // Build final court map objects
    const mapCourts = courts.map(court => {
      const courtId = court._id.toString();
      const stats = caseMap[courtId] || {};
      const delayStats = delayMap[courtId] || {};

      const totalCases = stats.total_cases || 0;
      const pending = stats.pending_cases || 0;
      const resolved = stats.resolved_cases || 0;
      const totalHearings = stats.total_hearings || 1; // prevent division by zero
      const totalAdjournments = stats.total_adjournments || 0;
      const stagnation = stats.stagnant_count || 0;

      // Adjournment rate = total adjournments / total hearings (as percentage)
      const adjournmentRate = totalHearings > 0
        ? parseFloat(((totalAdjournments / totalHearings) * 100).toFixed(2))
        : 0;

      // Resolution rate for JSI
      const resolutionRate = totalCases > 0 ? (resolved / totalCases) * 100 : 50;

      // Compute JSI (same formula as leaderboardService)
      const avgDelayScore = stats.avg_delay_score || 0;
      const avgAdjournments = totalCases > 0 ? totalAdjournments / totalCases : 0;
      const avgResolutionDays = 0; // Not computing per-court here, default safe value

      const speedScore = Math.max(0, 100 - (avgResolutionDays / 365) * 100);
      const adjScore = Math.max(0, 100 - (avgAdjournments / 10) * 100);
      const delayScore = Math.max(0, 100 - (avgDelayScore / 10) * 100);

      const jsiScore = parseFloat((
        resolutionRate * 0.40 +
        speedScore * 0.25 +
        adjScore * 0.20 +
        delayScore * 0.15
      ).toFixed(2));

      // Compute delay risk from JSI + stagnation
      const delayRisk = computeDelayRisk({
        jsi_score: jsiScore,
        stagnation_count: stagnation,
      });

      return {
        court_id: courtId,
        court_name: court.court_name,
        court_type: court.court_type,
        district: court.district,
        state: court.state,
        lat: court.lat,
        lng: court.lng,
        jsi_score: jsiScore,
        pending_cases: pending,
        adjournment_rate: adjournmentRate,
        stagnation_count: stagnation,
        delay_risk: delayRisk,
        risk_color: riskColor(delayRisk),
        risk_severity: riskSeverity(delayRisk),
        total_cases: totalCases,
        resolved_cases: resolved,
        high_risk_cases: delayStats.high_risk_count || 0,
      };
    });

    // ── Cache the full response in Redis (TTL 60s) ──
    try {
      await redis.set(
        MAP_KEYS.MAP_CACHE,
        JSON.stringify(mapCourts),
        'EX',
        MAP_KEYS.MAP_CACHE_TTL
      );
      logger.info(`[CourtMapService] Cached ${mapCourts.length} courts (TTL ${MAP_KEYS.MAP_CACHE_TTL}s)`);
    } catch (err) {
      logger.error(`[CourtMapService] Cache write failed: ${err.message}`);
    }

    // Apply filters
    let result = mapCourts;
    if (options.state) {
      result = result.filter(c => c.state?.toLowerCase() === options.state.toLowerCase());
    }
    if (options.risk) {
      result = result.filter(c => c.delay_risk === options.risk.toUpperCase());
    }

    return { courts: result, fromCache: false, total: result.length };

  } catch (err) {
    logger.error(`[CourtMapService] MongoDB query failed: ${err.message}`);
    throw err;
  }
}

module.exports = {
  MAP_KEYS,
  geoAddCourt,
  geoAddAllCourts,
  updateCourtMapData,
  invalidateMapCache,
  getMapData,
};
