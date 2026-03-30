// ============================================================
// Environment Configuration
// ============================================================
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 5000,

  // MongoDB
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/court_transparency',
  REDIS_URL: process.env.REDIS_URL || '',  // Full URL: redis:// or rediss:// (for Upstash)
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT, 10) || 6379,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'fallback-secret-dev-only',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '24h',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  // AI
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',

  // File Upload
  UPLOAD_DIR: process.env.UPLOAD_DIR || './uploads',
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE, 10) || 10 * 1024 * 1024,

  // Derived
  isDev: (process.env.NODE_ENV || 'development') === 'development',
  isProd: process.env.NODE_ENV === 'production',
};

module.exports = env;
