// ============================================================
// Audit Logging Middleware
// ============================================================
// Automatically logs all write operations (POST, PUT, PATCH, DELETE)
// to the audit_log collection for accountability tracking.
// ============================================================
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');

/**
 * Creates an audit log entry.
 * Can be called directly from route handlers for custom entries.
 *
 * @param {Object} params
 * @param {string} params.userId - Who performed the action
 * @param {string} params.action - What was done (e.g., 'case.create', 'disclosure.approve')
 * @param {string} params.entityType - Entity type ('case', 'document', 'user', etc.)
 * @param {string} params.entityId - ID of the affected entity
 * @param {Object} params.oldValue - Previous state (for updates)
 * @param {Object} params.newValue - New state (for creates/updates)
 * @param {string} params.ipAddress - Request IP
 * @param {string} params.userAgent - Request user agent
 */
async function createAuditEntry({
  userId, action, entityType, entityId,
  oldValue = null, newValue = null,
  ipAddress = null, userAgent = null,
}) {
  try {
    await AuditLog.create({
      user: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      old_value: oldValue,
      new_value: newValue,
      ip_address: ipAddress,
      user_agent: userAgent,
    });
  } catch (err) {
    // Never let audit logging break the request
    logger.error({ err }, 'Failed to create audit log entry');
  }
}

/**
 * Middleware: Automatically log write operations.
 * Attach to route groups where you want auto-logging.
 *
 * Usage: router.use(auditMiddleware('cases'))
 *
 * @param {string} entityType - The entity type for this route group
 */
function auditMiddleware(entityType) {
  return (req, res, next) => {
    // Only log write operations
    const writeMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (!writeMethods.includes(req.method)) {
      return next();
    }

    // Capture the original res.json to intercept the response
    const originalJson = res.json.bind(res);

    res.json = function (body) {
      // Log after the response is sent
      if (req.user && res.statusCode < 400) {
        const action = `${entityType}.${req.method.toLowerCase()}`;
        const entityId = req.params.id || body?.data?._id || body?.data?.case_id || null;

        createAuditEntry({
          userId: req.user._id,
          action,
          entityType,
          entityId,
          newValue: req.method === 'DELETE' ? null : (req.body || null),
          ipAddress: req.ip || req.connection?.remoteAddress,
          userAgent: req.headers['user-agent'],
        });
      }

      return originalJson(body);
    };

    next();
  };
}

module.exports = { createAuditEntry, auditMiddleware };
