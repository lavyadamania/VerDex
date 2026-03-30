// ============================================================
// Global Error Handler Middleware
// ============================================================
const logger = require('../utils/logger');
const env = require('../config/env');

/**
 * Custom application error class.
 * Use this to throw errors with specific HTTP status codes.
 */
class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true; // distinguishes from programming bugs
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 404 handler — place after all routes.
 */
function notFoundHandler(req, res, _next) {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} does not exist`,
  });
}

/**
 * Global error handler — place as last middleware.
 */
function errorHandler(err, req, res, _next) {
  // Default values
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Zod validation errors
  if (err.name === 'ZodError') {
    statusCode = 400;
    message = 'Validation failed';
    err.details = err.errors?.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
    }));
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid authentication token';
  }
  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Authentication token expired';
  }

  // PostgreSQL unique constraint violation
  if (err.code === '23505') {
    statusCode = 409;
    message = 'Resource already exists (duplicate entry)';
  }

  // Log server errors
  if (statusCode >= 500) {
    logger.error({ err, url: req.originalUrl, method: req.method }, 'Server Error');
  } else {
    logger.warn({ statusCode, message, url: req.originalUrl }, 'Client Error');
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(err.details && { details: err.details }),
    ...(env.isDev && statusCode >= 500 && { stack: err.stack }),
  });
}

module.exports = { AppError, notFoundHandler, errorHandler };
