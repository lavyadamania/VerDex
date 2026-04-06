// ============================================================
// MongoDB Connection (Mongoose)
// ============================================================
const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

const MONGO_URI = env.MONGO_URI || 'mongodb://localhost:27017/court_transparency';

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    logger.info(`[SUCCESS] MongoDB connected -- ${MONGO_URI.replace(/\/\/.*@/, '//***@')}`);
    return true;
  } catch (err) {
    logger.error({ err }, '[ERROR] MongoDB connection failed');
    return false;
  }
}

async function closeDB() {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed');
}

// Log connection events
mongoose.connection.on('error', (err) => {
  logger.error({ err }, 'MongoDB connection error');
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

module.exports = { connectDB, closeDB, mongoose };
