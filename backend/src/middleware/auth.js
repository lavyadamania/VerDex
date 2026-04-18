// ============================================================
// JWT Authentication Middleware
// ============================================================
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const { AppError } = require('./errorHandler');
const { normalizeRole } = require('../utils/roles');

/**
 * Middleware: Verify JWT token from Authorization header.
 * Attaches req.user with the full user document.
 */
async function authenticate(req, res, next) {
  try {
    // Extract token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('No authentication token provided', 401);
    }

    const token = authHeader.split(' ')[1];

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new AppError('Token expired. Please login again.', 401);
      }
      throw new AppError('Invalid authentication token', 401);
    }

    // Fetch user from DB
    const user = await User.findById(decoded.userId).select('-password_hash');
    if (!user) {
      throw new AppError('User not found. Token invalid.', 401);
    }

    if (!user.is_active) {
      throw new AppError('Account is deactivated', 403);
    }

    // Attach user to request
    user.role = normalizeRole(user.role);
    req.user = user;
    req.userId = user._id;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Middleware: Optional authentication.
 * If token is present, validates it and attaches user.
 * If no token, continues without user (req.user = null).
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      req.user = null;
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password_hash');
    if (user) user.role = normalizeRole(user.role);
    req.user = user;
    req.userId = user ? user._id : null;
  } catch {
    req.user = null;
    req.userId = null;
  }
  next();
}

module.exports = { authenticate, optionalAuth };
