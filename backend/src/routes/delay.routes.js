// ============================================================
// Delay Detection Routes — Admin & Staff APIs
// ============================================================
// Provides endpoints to view delay statistics, list delayed
// cases by severity level, manually trigger scans, and view
// delay history for individual cases.
// ============================================================
const express = require('express');
const router = express.Router();

const Case = require('../models/Case');
const Alert = require('../models/Alert');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { auditMiddleware, createAuditEntry } = require('../middleware/audit');
const { AppError } = require('../middleware/errorHandler');
const { getRedis } = require('../config/redis');
const { runDelayDetection, THRESHOLDS } = require('../workers/delayDetection');
const logger = require('../utils/logger');

// Audit all writes on delay routes
router.use(auditMiddleware('delay'));

// ============================================================
// GET /api/delays/summary — Delay statistics overview
// ============================================================
// Returns counts of delayed cases by severity level,
// overall risk distribution, and Redis set sizes.
// Access: admin, court_staff
// ============================================================
router.get('/summary', authenticate, authorize('admin', 'court_staff'), async (req, res, next) => {
  try {
    const redis = getRedis();

    // Get counts from Redis delay sets
    const [warningCount, highRiskCount, criticalCount] = await Promise.all([
      redis.scard('delay:warning'),
      redis.scard('delay:high_risk'),
      redis.scard('delay:critical'),
    ]);

    // Get aggregated stats from MongoDB
    const [
      totalActive,
      totalStagnant,
      riskDistribution,
      avgRiskScore,
      topDelayedCourts,
    ] = await Promise.all([
      // Total active (non-disposed) cases
      Case.countDocuments({ current_status: { $nin: ['disposed', 'judgment'] } }),

      // Stagnant cases
      Case.countDocuments({ stagnation_flag: true }),

      // Risk score distribution buckets
      Case.aggregate([
        { $match: { current_status: { $nin: ['disposed', 'judgment'] } } },
        {
          $bucket: {
            groupBy: '$delay_risk_score',
            boundaries: [0, 3, 6, 9, 11],
            default: 'other',
            output: { count: { $sum: 1 } },
          },
        },
      ]),

      // Average risk score across active cases
      Case.aggregate([
        { $match: { current_status: { $nin: ['disposed', 'judgment'] } } },
        { $group: { _id: null, avg: { $avg: '$delay_risk_score' } } },
      ]),

      // Top 5 courts with highest average delay
      Case.aggregate([
        { $match: { current_status: { $nin: ['disposed', 'judgment'] } } },
        {
          $group: {
            _id: '$court',
            avg_delay: { $avg: '$delay_risk_score' },
            case_count: { $sum: 1 },
            stagnant_count: { $sum: { $cond: ['$stagnation_flag', 1, 0] } },
          },
        },
        { $sort: { avg_delay: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: 'courts',
            localField: '_id',
            foreignField: '_id',
            as: 'court_info',
          },
        },
        { $unwind: { path: '$court_info', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            court_id: '$_id',
            court_name: '$court_info.court_name',
            district: '$court_info.district',
            state: '$court_info.state',
            avg_delay: { $round: ['$avg_delay', 2] },
            case_count: 1,
            stagnant_count: 1,
          },
        },
      ]),
    ]);

    // Format risk distribution
    const riskBuckets = {
      no_risk: 0,     // score 0-2
      warning: 0,      // score 3-5
      high_risk: 0,    // score 6-8
      critical: 0,     // score 9-10
    };

    for (const bucket of riskDistribution) {
      if (bucket._id === 0) riskBuckets.no_risk = bucket.count;
      else if (bucket._id === 3) riskBuckets.warning = bucket.count;
      else if (bucket._id === 6) riskBuckets.high_risk = bucket.count;
      else if (bucket._id === 9) riskBuckets.critical = bucket.count;
    }

    res.json({
      success: true,
      data: {
        overview: {
          total_active_cases: totalActive,
          total_delayed: warningCount + highRiskCount + criticalCount,
          total_stagnant: totalStagnant,
          avg_risk_score: parseFloat(avgRiskScore[0]?.avg?.toFixed(2) || '0'),
        },
        delay_counts: {
          warning: warningCount,
          high_risk: highRiskCount,
          critical: criticalCount,
        },
        risk_distribution: riskBuckets,
        top_delayed_courts: topDelayedCourts,
        thresholds: {
          warning: `${THRESHOLDS.WARNING.days}+ days (score ${THRESHOLDS.WARNING.minScore}-${THRESHOLDS.WARNING.maxScore})`,
          high_risk: `${THRESHOLDS.HIGH.days}+ days (score ${THRESHOLDS.HIGH.minScore}-${THRESHOLDS.HIGH.maxScore})`,
          critical: `${THRESHOLDS.CRITICAL.days}+ days (score ${THRESHOLDS.CRITICAL.minScore}-${THRESHOLDS.CRITICAL.maxScore})`,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/delays/cases — List delayed cases by severity
// ============================================================
// Query params:
//   level: 'warning' | 'high_risk' | 'critical' | 'all'
//   page:  page number (default: 1)
//   limit: items per page (default: 20)
//   sort:  sort field (default: '-delay_risk_score')
//
// Access: admin, court_staff
// ============================================================
router.get('/cases', authenticate, authorize('admin', 'court_staff'), async (req, res, next) => {
  try {
    const { level = 'all', page = 1, limit = 20, sort = '-delay_risk_score' } = req.query;
    const redis = getRedis();
    const skip = (parseInt(page) - 1) * parseInt(limit);

    let filter = { current_status: { $nin: ['disposed', 'judgment'] } };

    if (level === 'warning') {
      filter.delay_risk_score = { $gte: 3, $lt: 6 };
    } else if (level === 'high_risk') {
      filter.delay_risk_score = { $gte: 6, $lt: 9 };
    } else if (level === 'critical') {
      filter.delay_risk_score = { $gte: 9 };
    } else if (level === 'stagnant') {
      filter.stagnation_flag = true;
    } else {
      // 'all' delayed = score >= 3
      filter.delay_risk_score = { $gte: 3 };
    }

    const [cases, total] = await Promise.all([
      Case.find(filter)
        .populate('court', 'court_name district state')
        .populate('victim_user', 'full_name email')
        .select('cnr_number case_type case_title current_status filing_date last_update delay_risk_score stagnation_flag adjournment_count next_hearing_date court victim_user')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .lean({ virtuals: true }),
      Case.countDocuments(filter),
    ]);

    // Enrich with days since last update
    const now = new Date();
    const enrichedCases = cases.map(c => {
      const lastUpdate = new Date(c.last_update || c.createdAt);
      const daysSinceUpdate = Math.floor((now - lastUpdate) / (1000 * 60 * 60 * 24));

      return {
        ...c,
        days_since_update: daysSinceUpdate,
        risk_level: c.delay_risk_score >= 9 ? 'CRITICAL'
                  : c.delay_risk_score >= 6 ? 'HIGH'
                  : c.delay_risk_score >= 3 ? 'WARNING'
                  : 'NONE',
      };
    });

    // Also get Redis set counts for context
    const [warningCount, highRiskCount, criticalCount] = await Promise.all([
      redis.scard('delay:warning'),
      redis.scard('delay:high_risk'),
      redis.scard('delay:critical'),
    ]);

    res.json({
      success: true,
      data: {
        cases: enrichedCases,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit)),
        },
        filter_applied: level,
        redis_counts: {
          warning: warningCount,
          high_risk: highRiskCount,
          critical: criticalCount,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/delays/scan — Manually trigger delay detection scan
// ============================================================
// Runs the full delay detection worker on demand.
// Access: admin only
// ============================================================
router.post('/scan', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    logger.info(`🔍 Manual delay scan triggered by ${req.user.email}`);

    // Run the scan
    const summary = await runDelayDetection();

    // Audit log the manual trigger
    await createAuditEntry({
      userId: req.user._id,
      action: 'delay.manual_scan',
      entityType: 'system',
      entityId: null,
      newValue: summary,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: 'Delay detection scan completed successfully',
      data: { scan_results: summary },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/delays/history/:caseId — Delay alert history
// ============================================================
// Returns all delay-related alerts for a specific case,
// showing how the delay risk evolved over time.
// Access: admin, court_staff
// ============================================================
router.get('/history/:caseId', authenticate, authorize('admin', 'court_staff'), async (req, res, next) => {
  try {
    const { caseId } = req.params;

    // Verify case exists
    const caseDoc = await Case.findById(caseId)
      .select('cnr_number case_title current_status delay_risk_score stagnation_flag last_update filing_date')
      .lean({ virtuals: true });

    if (!caseDoc) {
      throw new AppError('Case not found', 404);
    }

    // Get all delay-related alerts for this case
    const delayAlerts = await Alert.find({
      case: caseId,
      alert_type: { $in: ['delay_warning', 'delay_high_risk', 'delay_critical', 'stagnation'] },
    })
      .sort({ createdAt: -1 })
      .lean();

    // Calculate current delay metrics
    const now = new Date();
    const lastUpdate = new Date(caseDoc.last_update || caseDoc.createdAt);
    const daysSinceUpdate = Math.floor((now - lastUpdate) / (1000 * 60 * 60 * 24));
    const daysSinceFiling = Math.floor((now - new Date(caseDoc.filing_date)) / (1000 * 60 * 60 * 24));

    // Check Redis set membership
    const redis = getRedis();
    const caseIdStr = caseId.toString();
    const [inWarning, inHighRisk, inCritical] = await Promise.all([
      redis.smembers('delay:warning').then(m => m.includes(caseIdStr)),
      redis.smembers('delay:high_risk').then(m => m.includes(caseIdStr)),
      redis.smembers('delay:critical').then(m => m.includes(caseIdStr)),
    ]);

    let currentLevel = 'none';
    if (inCritical) currentLevel = 'critical';
    else if (inHighRisk) currentLevel = 'high_risk';
    else if (inWarning) currentLevel = 'warning';

    res.json({
      success: true,
      data: {
        case: {
          id: caseDoc._id,
          cnr_number: caseDoc.cnr_number,
          case_title: caseDoc.case_title,
          current_status: caseDoc.current_status,
          delay_risk_score: caseDoc.delay_risk_score,
          stagnation_flag: caseDoc.stagnation_flag,
        },
        current_metrics: {
          days_since_last_update: daysSinceUpdate,
          days_since_filing: daysSinceFiling,
          current_redis_level: currentLevel,
        },
        alert_history: delayAlerts.map(a => ({
          id: a._id,
          type: a.alert_type,
          title: a.alert_title,
          message: a.alert_message,
          severity: a.severity,
          is_read: a.is_read,
          created_at: a.createdAt,
        })),
        total_delay_alerts: delayAlerts.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/delays/redis-sets — View raw Redis delay set contents
// ============================================================
// Debug/admin endpoint to see which case IDs are in each set.
// Access: admin only
// ============================================================
router.get('/redis-sets', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const redis = getRedis();

    const [warningIds, highRiskIds, criticalIds] = await Promise.all([
      redis.smembers('delay:warning'),
      redis.smembers('delay:high_risk'),
      redis.smembers('delay:critical'),
    ]);

    res.json({
      success: true,
      data: {
        delay_warning: {
          count: warningIds.length,
          case_ids: warningIds,
        },
        delay_high_risk: {
          count: highRiskIds.length,
          case_ids: highRiskIds,
        },
        delay_critical: {
          count: criticalIds.length,
          case_ids: criticalIds,
        },
        total_delayed: warningIds.length + highRiskIds.length + criticalIds.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
