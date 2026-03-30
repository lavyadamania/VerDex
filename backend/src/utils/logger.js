// ============================================================
// Structured Logger (Pino)
// ============================================================
const pino = require('pino');
const env = require('../config/env');

const logger = pino({
  level: env.isDev ? 'debug' : 'info',
  transport: env.isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined, // JSON output in production
});

module.exports = logger;
