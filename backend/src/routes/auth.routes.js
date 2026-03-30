// ============================================================
// Auth Routes — Registration, Login, OTP, Refresh, Logout
// ============================================================
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');

const User = require('../models/User');
const env = require('../config/env');
const { getRedis } = require('../config/redis');
const { validate } = require('../middleware/validator');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

// ============================================================
// Validation Schemas
// ============================================================
const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  full_name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().optional(),
  role: z.enum(['victim', 'advocate', 'visitor']).default('victim'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const otpSchema = z.object({
  otp: z.string().length(6, 'OTP must be 6 digits'),
});

// ============================================================
// Helper: Generate JWT
// ============================================================
function generateToken(userId, role) {
  return jwt.sign(
    { userId, role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

function generateRefreshToken(userId) {
  return jwt.sign(
    { userId, type: 'refresh' },
    env.JWT_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN }
  );
}

// ============================================================
// Helper: Generate 6-digit OTP (simulated)
// ============================================================
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ============================================================
// POST /api/auth/register
// ============================================================
router.post('/register', authLimiter, validate(registerSchema), async (req, res, next) => {
  try {
    const { email, password, full_name, phone, role } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      throw new AppError('User with this email already exists', 409);
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);

    // Create user
    const user = await User.create({
      email,
      password_hash,
      full_name,
      phone,
      role,
      verification_status: 'unverified',
    });

    // Generate OTP and store in Redis (5 min TTL)
    const otp = generateOTP();
    const redis = getRedis();
    await redis.set(`otp:${user._id}`, otp, 'EX', 300); // 5 minutes

    // ⚡ SIMULATED: In production, send via SMS/email
    logger.info('═══════════════════════════════════════════════════');
    logger.info(`  📧 SIMULATED OTP for ${email}: ${otp}`);
    logger.info('═══════════════════════════════════════════════════');

    // Also save OTP in user doc (backup for simulated mode)
    user.otp_code = otp;
    user.otp_expires_at = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Registration successful. OTP sent for verification.',
      data: {
        user_id: user._id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        verification_status: user.verification_status,
        otp_hint: env.isDev ? `DEV MODE: OTP is ${otp}` : undefined,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/verify-otp
// ============================================================
router.post('/verify-otp', authLimiter, authenticate, validate(otpSchema), async (req, res, next) => {
  try {
    const { otp } = req.body;
    const userId = req.user._id;

    // Check Redis first
    const redis = getRedis();
    const storedOtp = await redis.get(`otp:${userId}`);

    let valid = false;

    if (storedOtp) {
      valid = storedOtp === otp;
    } else {
      // Fallback: check user doc
      const user = await User.findById(userId);
      if (user.otp_code === otp && user.otp_expires_at > new Date()) {
        valid = true;
      }
    }

    if (!valid) {
      throw new AppError('Invalid or expired OTP', 400);
    }

    // Update verification status
    const user = await User.findByIdAndUpdate(
      userId,
      {
        verification_status: 'otp_verified',
        otp_code: null,
        otp_expires_at: null,
      },
      { new: true }
    );

    // Clean up Redis
    await redis.del(`otp:${userId}`);

    logger.info(`✅ OTP verified for user ${user.email}`);

    res.json({
      success: true,
      message: 'OTP verified successfully. Account is now OTP-verified.',
      data: {
        user_id: user._id,
        email: user.email,
        verification_status: user.verification_status,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/resend-otp
// ============================================================
router.post('/resend-otp', authLimiter, authenticate, async (req, res, next) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);

    if (user.verification_status !== 'unverified') {
      throw new AppError('OTP already verified', 400);
    }

    // Generate new OTP
    const otp = generateOTP();
    const redis = getRedis();
    await redis.set(`otp:${userId}`, otp, 'EX', 300);

    user.otp_code = otp;
    user.otp_expires_at = new Date(Date.now() + 5 * 60 * 1000);
    await user.save();

    logger.info('═══════════════════════════════════════════════════');
    logger.info(`  📧 RESENT OTP for ${user.email}: ${otp}`);
    logger.info('═══════════════════════════════════════════════════');

    res.json({
      success: true,
      message: 'OTP resent successfully.',
      data: {
        otp_hint: env.isDev ? `DEV MODE: OTP is ${otp}` : undefined,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/login
// ============================================================
router.post('/login', authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user (include password_hash for verification)
    const user = await User.findOne({ email }).select('+password_hash');
    if (!user) {
      throw new AppError('Invalid email or password', 401);
    }

    if (!user.is_active) {
      throw new AppError('Account is deactivated. Contact admin.', 403);
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      throw new AppError('Invalid email or password', 401);
    }

    // Generate tokens
    const token = generateToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id);

    // Store refresh token in Redis
    const redis = getRedis();
    await redis.set(
      `refresh:${user._id}`,
      refreshToken,
      'EX',
      7 * 24 * 60 * 60 // 7 days
    );

    // Update last login
    user.last_login = new Date();
    await user.save();

    logger.info(`🔑 User logged in: ${user.email} (${user.role})`);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        refreshToken,
        user: {
          _id: user._id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          verification_status: user.verification_status,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/refresh
// ============================================================
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      throw new AppError('Refresh token is required', 400);
    }

    // Verify refresh token
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, env.JWT_SECRET);
    } catch {
      throw new AppError('Invalid or expired refresh token', 401);
    }

    if (decoded.type !== 'refresh') {
      throw new AppError('Invalid token type', 401);
    }

    // Check if refresh token exists in Redis
    const redis = getRedis();
    const storedToken = await redis.get(`refresh:${decoded.userId}`);
    if (!storedToken || storedToken !== refreshToken) {
      throw new AppError('Refresh token revoked or invalid', 401);
    }

    // Fetch user
    const user = await User.findById(decoded.userId);
    if (!user || !user.is_active) {
      throw new AppError('User not found or deactivated', 401);
    }

    // Generate new tokens
    const newToken = generateToken(user._id, user.role);
    const newRefreshToken = generateRefreshToken(user._id);

    // Replace refresh token in Redis
    await redis.set(
      `refresh:${user._id}`,
      newRefreshToken,
      'EX',
      7 * 24 * 60 * 60
    );

    res.json({
      success: true,
      message: 'Token refreshed',
      data: {
        token: newToken,
        refreshToken: newRefreshToken,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/auth/logout
// ============================================================
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const redis = getRedis();

    // Remove refresh token from Redis
    await redis.del(`refresh:${req.user._id}`);

    logger.info(`👋 User logged out: ${req.user.email}`);

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/auth/me — Get current user profile
// ============================================================
router.get('/me', authenticate, async (req, res) => {
  res.json({
    success: true,
    data: {
      user: req.user,
    },
  });
});

module.exports = router;
