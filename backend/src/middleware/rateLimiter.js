// ============================================================
// Rate Limiter Middleware (Redis-backed)
// ============================================================
const { getRedis } = require('../config/redis');
const { AppError } = require('./errorHandler');

/**
 * Creates a rate limiter middleware.
 * Uses Redis to track request counts per IP.
 *
 * @param {Object} options
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000 = 1 min)
 * @param {number} options.max - Max requests per window (default: 100)
 * @param {string} options.message - Error message when limited
 */
function rateLimiter({
  windowMs = 60 * 1000,
  max = 100,
  message = 'Too many requests. Please try again later.',
} = {}) {
  const windowSec = Math.ceil(windowMs / 1000);

  return async (req, res, next) => {
    try {
      const redis = getRedis();
      const ip = req.ip || req.connection.remoteAddress;
      const key = `ratelimit:${ip}:${req.route ? req.route.path : req.path}`;

      const current = await redis.incr(key);

      // Set expiry on first request
      if (current === 1) {
        await redis.expire(key, windowSec);
      }

      // Set rate limit headers
      res.set('X-RateLimit-Limit', String(max));
      res.set('X-RateLimit-Remaining', String(Math.max(0, max - current)));

      if (current > max) {
        const ttl = await redis.ttl(key);
        res.set('Retry-After', String(ttl));
        throw new AppError(message, 429);
      }

      next();
    } catch (err) {
      if (err.statusCode === 429) return next(err);
      // If Redis fails, let request through (fail-open)
      next();
    }
  };
}

// Pre-configured limiters
const apiLimiter = rateLimiter({ windowMs: 60 * 1000, max: 100 });
const uploadLimiter = rateLimiter({ windowMs: 60 * 1000, max: 10, message: 'Too many uploads. Try again in a minute.' });

module.exports = { rateLimiter, apiLimiter, uploadLimiter };
