// ============================================================
// RBAC (Role-Based Access Control) Middleware
// ============================================================
// Roles: admin, court_staff, victim, advocate, visitor
//
// Permissions Matrix:
// ┌──────────────┬───────┬────────────┬────────┬──────────┬─────────┐
// │ Action       │ admin │ court_staff│ victim │ advocate │ visitor │
// ├──────────────┼───────┼────────────┼────────┼──────────┼─────────┤
// │ View public  │  ✅   │     ✅     │   ✅   │    ✅    │   ✅    │
// │ View own case│  ✅   │     ✅     │   ✅   │    ✅    │   ❌    │
// │ Create case  │  ✅   │     ❌     │   ✅   │    ✅    │   ❌    │
// │ Upload docs  │  ✅   │     ❌     │   ✅   │    ✅    │   ❌    │
// │ Disclosure   │  ✅   │     ❌     │   ✅   │    ❌    │   ❌    │
// │ Admin panel  │  ✅   │     ✅     │   ❌   │    ❌    │   ❌    │
// │ Manage users │  ✅   │     ❌     │   ❌   │    ❌    │   ❌    │
// │ Leaderboard  │  ✅   │     ✅     │   ✅   │    ✅    │   ✅    │
// │ Audit logs   │  ✅   │     ❌     │   ❌   │    ❌    │   ❌    │
// └──────────────┴───────┴────────────┴────────┴──────────┴─────────┘
// ============================================================
const { AppError } = require('./errorHandler');
const { hasRole } = require('../utils/roles');

/**
 * Middleware: Restrict access to specific roles.
 * Must be used AFTER authenticate middleware.
 *
 * Usage: authorize('admin', 'court_staff')
 *
 * @param  {...string} roles - allowed roles
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    if (!hasRole(req.user.role, ...roles)) {
      return next(
        new AppError(
          `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.user.role}`,
          403
        )
      );
    }

    next();
  };
}

/**
 * Middleware: Block visitor role from write operations.
 * Visitors can only use GET/HEAD/OPTIONS methods.
 * Use this on route groups where visitors should have read-only access.
 */
function readOnlyForVisitor(req, res, next) {
  if (!req.user) {
    return next(); // unauthenticated — handled by authenticate middleware
  }

  if (req.user.role === 'visitor') {
    const readOnlyMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (!readOnlyMethods.includes(req.method)) {
      return next(
        new AppError(
          'Visitors have read-only access. You cannot create, update, or delete resources.',
          403
        )
      );
    }
  }

  next();
}

/**
 * Middleware: Block visitors entirely from a route.
 * Use on routes that visitors should never access (e.g., case creation, disclosure).
 */
function denyVisitor(req, res, next) {
  if (req.user && req.user.role === 'visitor') {
    return next(
      new AppError(
          'This feature is not available for visitor accounts. Please register as a user or advocate.',
        403
      )
    );
  }
  next();
}

/**
 * Middleware: Restrict to verified users only.
 * Checks verification_status >= required level.
 * Visitors are auto-denied (they don't need verification for viewing).
 *
 * Usage: requireVerification('otp_verified')
 */
function requireVerification(minLevel = 'otp_verified') {
  const levels = {
    'unverified': 0,
    'otp_verified': 1,
    'document_verified': 2,
    'fully_verified': 3,
  };

  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    // Visitors don't go through verification flow
    if (req.user.role === 'visitor') {
      return next(
        new AppError('Visitors cannot access verified-only features. Please register as a user or advocate.', 403)
      );
    }

    const userLevel = levels[req.user.verification_status] || 0;
    const requiredLevel = levels[minLevel] || 0;

    if (userLevel < requiredLevel) {
      return next(
        new AppError(
          `Verification required: minimum level is "${minLevel}". Your level: "${req.user.verification_status}"`,
          403
        )
      );
    }

    next();
  };
}

/**
 * Middleware: Check if user owns the resource or is admin.
 * Requires the resource to have a field matching the user ID.
 *
 * Usage: isOwnerOrAdmin('victim_user')   // checks if req.resource.victim_user === req.user._id
 * Note: Must attach `req.resource` before using this middleware.
 */
function isOwnerOrAdmin(ownerField = 'victim_user') {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    // Admins and court staff can access everything
    if (['admin', 'court_staff'].includes(req.user.role)) {
      return next();
    }

    // Visitors cannot access individual resources
    if (req.user.role === 'visitor') {
      return next(new AppError('Visitors cannot access individual case details.', 403));
    }

    // Check ownership
    const resource = req.resource;
    if (!resource) {
      return next(new AppError('Resource not found', 404));
    }

    const ownerId = resource[ownerField];
    if (!ownerId || ownerId.toString() !== req.user._id.toString()) {
      return next(new AppError('Access denied. You do not own this resource.', 403));
    }

    next();
  };
}

module.exports = {
  authorize,
  readOnlyForVisitor,
  denyVisitor,
  requireVerification,
  isOwnerOrAdmin,
};
