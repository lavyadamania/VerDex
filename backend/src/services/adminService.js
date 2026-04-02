// ============================================================
// Admin Dashboard Service
// ============================================================
// Provides aggregate data and advanced filtering for admins:
//   1. Comprehensive stats (users, cases, status breakdown)
//   2. Stuck cases analysis (high delay risk scores)
//   3. Court performance comparison
//   4. Audit log retrieval
// ============================================================
const Case = require('../models/Case');
const User = require('../models/User');
const Court = require('../models/Court');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

/**
 * Get high-level system statistics for the admin dashboard.
 */
async function getAdminStats() {
  const [
    totalUsers,
    totalCases,
    totalCourts,
    statusCounts,
    roleCounts,
    stagnantCount,
    avgDelayRisk,
  ] = await Promise.all([
    User.countDocuments(),
    Case.countDocuments(),
    Court.countDocuments(),
    Case.aggregate([{ $group: { _id: '$current_status', count: { $sum: 1 } } }]),
    User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    Case.countDocuments({ stagnation_flag: true }),
    Case.aggregate([{ $group: { _id: null, avg: { $avg: '$delay_risk_score' } } }]),
  ]);

  const byStatus = {};
  statusCounts.forEach(s => { byStatus[s._id] = s.count; });

  const byRole = {};
  roleCounts.forEach(r => { byRole[r._id] = r.count; });

  return {
    overview: {
      total_users: totalUsers,
      total_cases: totalCases,
      total_courts: totalCourts,
      stagnant_cases: stagnantCount,
      avg_delay_risk: parseFloat((avgDelayRisk[0]?.avg || 0).toFixed(2)),
    },
    by_status: byStatus,
    by_role: byRole,
  };
}

/**
 * Get cases that are "stuck" (high delay risk score).
 * 
 * @param {Object} options { page, limit, threshold }
 */
async function getStuckCases({ page = 1, limit = 20, threshold = 7 }) {
  const skip = (page - 1) * limit;

  const query = {
    current_status: { $nin: ['disposed', 'judgment'] },
    delay_risk_score: { $gte: threshold },
  };

  const [cases, total] = await Promise.all([
    Case.find(query)
      .populate('court', 'court_name district state')
      .populate('victim_user', 'full_name email phone')
      .sort({ delay_risk_score: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Case.countDocuments(query),
  ]);

  return {
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    cases,
  };
}

/**
 * Get court-wise analytics aggregation.
 */
async function getCourtAnalytics() {
  return Case.aggregate([
    {
      $group: {
        _id: '$court',
        total_cases: { $sum: 1 },
        resolved_cases: {
          $sum: {
            $cond: [
              { $in: ['$current_status', ['disposed', 'judgment']] },
              1,
              0
            ]
          }
        },
        avg_handling_time: {
          $avg: {
            $cond: [
              { $and: [{ $in: ['$current_status', ['disposed', 'judgment']] }, { $ne: ['$filing_date', null] }] },
              { $subtract: [new Date(), '$filing_date'] },
              null
            ]
          }
        },
        avg_delay_score: { $avg: '$delay_risk_score' }
      }
    },
    {
      $lookup: {
        from: 'courts',
        localField: '_id',
        foreignField: '_id',
        as: 'court_info'
      }
    },
    { $unwind: '$court_info' },
    {
      $project: {
        court_name: '$court_info.court_name',
        district: '$court_info.district',
        state: '$court_info.state',
        total_cases: 1,
        resolved_cases: 1,
        avg_delay_score: { $round: ['$avg_delay_score', 2] },
        resolution_rate: {
          $round: [
            { $multiply: [{ $divide: ['$resolved_cases', '$total_cases'] }, 100] },
            2
          ]
        }
      }
    },
    { $sort: { resolution_rate: -1 } }
  ]);
}

/**
 * Get audit logs with pagination and filters.
 */
async function getAuditLogs({ page = 1, limit = 50, action, userId, entityType }) {
  const skip = (page - 1) * limit;
  const query = {};

  if (action) query.action = action;
  if (userId) query.user = userId;
  if (entityType) query.entity_type = entityType;

  const [logs, total] = await Promise.all([
    AuditLog.find(query)
      .populate('user', 'full_name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(query),
  ]);

  return {
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
    logs,
  };
}

module.exports = {
  getAdminStats,
  getStuckCases,
  getCourtAnalytics,
  getAuditLogs,
};
