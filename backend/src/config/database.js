// ============================================================
// MongoDB Connection (Mongoose)
// ============================================================
const mongoose = require('mongoose');
const dns = require('dns');
const env = require('./env');
const logger = require('../utils/logger');

// ── ADVANCED DNS FIX ──
// Create a dedicated resolver pointed at Google DNS (8.8.8.8)
const resolver = new dns.Resolver();
resolver.setServers(['8.8.8.8', '8.8.4.4']);

/**
 * Custom DNS lookup function that forces resolution through Google DNS.
 * This is passed to the MongoDB driver to bypass local DNS blocks.
 */
function customLookup(hostname, options, callback) {
  // If it's localhost, use the default lookup
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return dns.lookup(hostname, options, callback);
  }

  // Use our Google DNS resolver
  resolver.resolve4(hostname, (err, addresses) => {
    if (err || !addresses.length) {
      // Fallback to default lookup if Google DNS fails
      return dns.lookup(hostname, options, callback);
    }
    // Return the first address found
    callback(null, addresses[0], 4);
  });
}

const MONGO_URI = env.MONGO_URI || 'mongodb://localhost:27017/court_transparency';

async function connectDB() {
  try {
    const isAtlas = MONGO_URI.includes('mongodb.net');
    const options = {
      connectTimeoutMS: 20000,
      socketTimeoutMS: 45000,
      family: 4, // Force IPv4
      lookup: customLookup, // Force our Google DNS resolver
    };
    logger.info(`[SYSTEM] Attempting MongoDB connection (${isAtlas ? 'Atlas' : 'local/standard'})...`);
    await mongoose.connect(MONGO_URI, options);
    logger.info(`[SUCCESS] MongoDB connected -- ${MONGO_URI.replace(/\/\/.*@/, '//***@')}`);
    return true;
  } catch (err) {
    logger.error({ 
      message: err.message,
      code: err.code,
      name: err.name,
      stack: err.stack 
    }, '[ERROR] MongoDB connection failed');
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
