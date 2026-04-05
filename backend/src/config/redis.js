// ============================================================
// Redis Connection — Supports Local Redis / Upstash / Fallback
// ============================================================
// Priority:
// 1. REDIS_URL (Upstash connection string) — if provided
// 2. REDIS_HOST:REDIS_PORT (local Redis) — if running
// 3. In-memory fallback — always works
// ============================================================
const Redis = require('ioredis');
const env = require('./env');
const logger = require('../utils/logger');

let redis = null;
let useMemoryStore = false;

// ── In-Memory Redis-like Store (fallback) ──
class MemoryRedis {
  constructor() {
    this.store = new Map();
    this.ttls = new Map();
  }
  async ping() { return 'PONG'; }
  async get(key) { this._checkExpiry(key); return this.store.get(key) || null; }
  async set(key, value, ...args) {
    this.store.set(key, String(value));
    const exIdx = args.indexOf('EX');
    if (exIdx !== -1 && args[exIdx + 1]) this.ttls.set(key, Date.now() + (parseInt(args[exIdx + 1]) * 1000));
    return 'OK';
  }
  async del(key) { this.store.delete(key); this.ttls.delete(key); return 1; }
  async incr(key) { const v = parseInt(await this.get(key) || '0') + 1; this.store.set(key, String(v)); return v; }
  async expire(key, s) { this.ttls.set(key, Date.now() + s * 1000); return 1; }
  async ttl(key) { const e = this.ttls.get(key); if (!e) return -1; const r = Math.ceil((e - Date.now()) / 1000); return r > 0 ? r : -2; }
  async hset(key, field, value) { if (!this.store.has(key)) this.store.set(key, {}); this.store.get(key)[field] = String(value); return 1; }
  async hget(key, field) { const h = this.store.get(key); return h ? (h[field] || null) : null; }
  async hgetall(key) { return this.store.get(key) || {}; }
  async hdel(key, field) { const h = this.store.get(key); if (h) delete h[field]; return 1; }
  async sadd(key, ...m) { if (!this.store.has(key)) this.store.set(key, new Set()); m.forEach(v => this.store.get(key).add(String(v))); return m.length; }
  async smembers(key) { const s = this.store.get(key); return s instanceof Set ? [...s] : []; }
  async srem(key, ...m) { const s = this.store.get(key); if (s instanceof Set) m.forEach(v => s.delete(String(v))); return m.length; }
  async scard(key) { const s = this.store.get(key); return s instanceof Set ? s.size : 0; }
  async zadd(key, score, member) { if (!this.store.has(key)) this.store.set(key, []); const z = this.store.get(key); const i = z.findIndex(e => e.member === String(member)); if (i !== -1) z[i].score = parseFloat(score); else z.push({ member: String(member), score: parseFloat(score) }); z.sort((a, b) => a.score - b.score); return 1; }
  async zrevrange(key, start, stop, ws) { const z = this.store.get(key) || []; const r = [...z].reverse(); const end = stop === -1 ? r.length : stop + 1; const s = r.slice(start, end); if (ws === 'WITHSCORES') return s.flatMap(e => [e.member, String(e.score)]); return s.map(e => e.member); }
  async zrange(key, start, stop) { const z = this.store.get(key) || []; const end = stop === -1 ? z.length : stop + 1; return z.slice(start, end).map(e => e.member); }
  async keys(pattern) { const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$'); return [...this.store.keys()].filter(k => re.test(k)); }
  async flushall() { this.store.clear(); this.ttls.clear(); return 'OK'; }
  async geoadd(key, ...args) { if (!this.store.has(key)) this.store.set(key, []); const g = this.store.get(key); for (let i = 0; i < args.length - 2; i += 3) { const lng = parseFloat(args[i]); const lat = parseFloat(args[i+1]); const member = String(args[i+2]); const idx = g.findIndex(e => e.member === member); if (idx !== -1) { g[idx] = { member, lng, lat }; } else { g.push({ member, lng, lat }); } } return args.length / 3; }
  async publish() { return 0; }
  async subscribe() { return; }
  on() { return this; }
  async quit() { return 'OK'; }
  async disconnect() { return; }
  _checkExpiry(key) { const e = this.ttls.get(key); if (e && Date.now() > e) { this.store.delete(key); this.ttls.delete(key); } }
}

/**
 * Connect to Redis. Tries real Redis first, falls back to memory.
 */
async function connectRedis() {
  // ── Try real Redis ──
  try {
    let client;

    if (env.REDIS_URL) {
      // Upstash or any Redis URL (rediss:// for TLS)
      client = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: null,
        connectTimeout: 5000,
        tls: env.REDIS_URL.startsWith('rediss://') ? {} : undefined,
      });
      logger.info('Connecting to Redis via URL...');
    } else {
      // Local Redis
      client = new Redis({
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
        connectTimeout: 3000,
        retryStrategy(times) {
          if (times > 2) return null;
          return 500;
        },
      });
      logger.info(`Connecting to Redis at ${env.REDIS_HOST}:${env.REDIS_PORT}...`);
    }

    const pong = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.disconnect();
        reject(new Error('Redis connection timeout'));
      }, 5000);

      client.on('ready', async () => {
        clearTimeout(timeout);
        try { resolve(await client.ping()); } catch (e) { reject(e); }
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        client.disconnect();
        reject(err);
      });
    });

    if (pong === 'PONG') {
      redis = client;
      useMemoryStore = false;
      logger.info('✅ Redis connected (real Redis server)');
      return true;
    }
  } catch (err) {
    logger.warn(`⚠️  Redis not available (${err.message}) — using in-memory store`);
  }

  // ── Fallback to memory store ──
  redis = new MemoryRedis();
  useMemoryStore = true;
  logger.info('✅ In-Memory Redis store active (fallback)');
  return true;
}

function getRedis() { return redis; }
function isMemoryStore() { return useMemoryStore; }
async function disconnectRedis() { if (redis) { await redis.quit(); logger.info('Redis connection closed'); } }

module.exports = { getRedis, connectRedis, disconnectRedis, isMemoryStore };
