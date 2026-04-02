// ============================================================
// Stage 12 Test — Leaderboard & Analytics Engine
// ============================================================
// Seeds multiple courts and cases, runs the leaderboard
// computation, and verifies:
//   1. JSI (Justice Speed Index) calculated correctly
//   2. Rankings stored in Redis sorted set
//   3. Per-court metrics stored in Redis hashes
//   4. System stats computed
//   5. Courts with better resolution rates rank higher
//   6. Court model counters updated
//
// Usage: node src/tests/testLeaderboard.js
// ============================================================
const mongoose = require('mongoose');
const env = require('../config/env');
const { connectDB, closeDB } = require('../config/database');
const { connectRedis, disconnectRedis, getRedis } = require('../config/redis');
const Case = require('../models/Case');
const Court = require('../models/Court');
const User = require('../models/User');
const { computeLeaderboard, getLeaderboard, REDIS_KEYS } = require('../services/leaderboardService');

// Helpers
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

const testIds = { users: [], courts: [], cases: [] };

async function setup() {
  console.log('\n🔧 Setting up test data...\n');

  // Create a test user
  const user = await User.create({
    full_name: 'Leaderboard Test Victim',
    email: `lbtest_${Date.now()}@test.com`,
    phone: '7777777777',
    password_hash: '$2a$10$testhashedpassword',
    role: 'victim',
    verification_status: 'otp_verified',
  });
  testIds.users.push(user._id);

  // Court A: GOOD court — 8 resolved out of 10 (80% resolution)
  const courtA = await Court.create({
    court_name: 'LB Test Court Alpha (Fast)',
    court_type: 'district',
    district: 'Alpha District',
    state: 'Test State',
    pin_code: '200001',
  });
  testIds.courts.push(courtA._id);

  // Court B: AVERAGE court — 3 resolved out of 10 (30% resolution)
  const courtB = await Court.create({
    court_name: 'LB Test Court Beta (Avg)',
    court_type: 'sessions',
    district: 'Beta District',
    state: 'Test State',
    pin_code: '200002',
  });
  testIds.courts.push(courtB._id);

  // Court C: BAD court — 1 resolved out of 10, high delays
  const courtC = await Court.create({
    court_name: 'LB Test Court Gamma (Slow)',
    court_type: 'magistrate',
    district: 'Gamma District',
    state: 'Test State',
    pin_code: '200003',
  });
  testIds.courts.push(courtC._id);

  // Seed cases for Court A (good performance)
  const caseTypes = ['fraud', 'theft', 'cybercrime', 'domestic_violence', 'murder'];
  for (let i = 0; i < 10; i++) {
    const isResolved = i < 8; // 8 out of 10 resolved
    const c = await Case.create({
      cnr_number: `LB-A-${Date.now()}-${i}`,
      case_type: caseTypes[i % caseTypes.length],
      court: courtA._id,
      victim_user: user._id,
      filing_date: daysAgo(120),
      last_update: isResolved ? daysAgo(5) : daysAgo(10),
      current_status: isResolved ? 'disposed' : 'hearing',
      adjournment_count: isResolved ? 1 : 2,
      delay_risk_score: isResolved ? 0 : 1,
    });
    testIds.cases.push(c._id);
  }
  console.log('   ✅ Court Alpha: 10 cases (8 resolved, 2 pending)');

  // Seed cases for Court B (average)
  for (let i = 0; i < 10; i++) {
    const isResolved = i < 3; // 3 out of 10 resolved
    const c = await Case.create({
      cnr_number: `LB-B-${Date.now()}-${i}`,
      case_type: caseTypes[i % caseTypes.length],
      court: courtB._id,
      victim_user: user._id,
      filing_date: daysAgo(200),
      last_update: isResolved ? daysAgo(10) : daysAgo(45),
      current_status: isResolved ? 'disposed' : 'evidence',
      adjournment_count: isResolved ? 3 : 5,
      delay_risk_score: isResolved ? 0 : 4,
    });
    testIds.cases.push(c._id);
  }
  console.log('   ✅ Court Beta: 10 cases (3 resolved, 7 pending)');

  // Seed cases for Court C (bad performance)
  for (let i = 0; i < 10; i++) {
    const isResolved = i < 1; // Only 1 out of 10 resolved
    const c = await Case.create({
      cnr_number: `LB-C-${Date.now()}-${i}`,
      case_type: caseTypes[i % caseTypes.length],
      court: courtC._id,
      victim_user: user._id,
      filing_date: daysAgo(300),
      last_update: isResolved ? daysAgo(30) : daysAgo(100),
      current_status: isResolved ? 'judgment' : 'filed',
      adjournment_count: isResolved ? 5 : 8,
      delay_risk_score: isResolved ? 0 : 9,
      stagnation_flag: !isResolved,
    });
    testIds.cases.push(c._id);
  }
  console.log('   ✅ Court Gamma: 10 cases (1 resolved, 9 pending, high delays)');

  return { user, courts: [courtA, courtB, courtC] };
}

async function runComputation() {
  console.log('\n🚀 Running leaderboard computation...\n');
  const result = await computeLeaderboard();
  console.log('\n📊 System Stats:', JSON.stringify(result.systemStats, null, 2));
  return result;
}

async function verify(testData, result) {
  console.log('\n🔍 Verifying results...\n');
  const redis = getRedis();
  let passed = 0;
  let failed = 0;

  function check(name, condition) {
    if (condition) {
      console.log(`   ✅ PASS: ${name}`);
      passed++;
    } else {
      console.log(`   ❌ FAIL: ${name}`);
      failed++;
    }
  }

  const [courtA, courtB, courtC] = testData.courts;

  // ── 1. Rankings computed correctly ──
  console.log('\n   --- Rankings ---');
  check('Result has courts array', result.courts.length >= 3);

  // Find our test courts in the results
  const rankA = result.courts.find(c => c.court_id === courtA._id.toString());
  const rankB = result.courts.find(c => c.court_id === courtB._id.toString());
  const rankC = result.courts.find(c => c.court_id === courtC._id.toString());

  check('Court Alpha found in results', !!rankA);
  check('Court Beta found in results', !!rankB);
  check('Court Gamma found in results', !!rankC);

  if (rankA && rankB && rankC) {
    // ── 2. JSI scores make sense ──
    console.log('\n   --- JSI Scores ---');
    console.log(`      Alpha JSI: ${rankA.justice_speed_index}, Beta JSI: ${rankB.justice_speed_index}, Gamma JSI: ${rankC.justice_speed_index}`);

    check('Court Alpha JSI > Court Beta JSI', rankA.justice_speed_index > rankB.justice_speed_index);
    check('Court Beta JSI > Court Gamma JSI', rankB.justice_speed_index > rankC.justice_speed_index);

    // ── 3. Resolution rates correct ──
    console.log('\n   --- Resolution Rates ---');
    check('Court Alpha resolution_rate = 80%', rankA.resolution_rate === 80);
    check('Court Beta resolution_rate = 30%', rankB.resolution_rate === 30);
    check('Court Gamma resolution_rate = 10%', rankC.resolution_rate === 10);

    // ── 4. Alpha ranks higher than Gamma ──
    check('Court Alpha rank < Court Gamma rank', rankA.rank < rankC.rank);
  }

  // ── 5. Redis sorted set populated ──
  console.log('\n   --- Redis Storage ---');
  const leaderboardMembers = await redis.zrevrange(REDIS_KEYS.LEADERBOARD, 0, -1, 'WITHSCORES');
  check('Redis sorted set has entries', leaderboardMembers.length >= 6); // 3 courts × 2 (member+score)

  // Check per-court hash exists
  const courtAMetrics = await redis.hgetall(REDIS_KEYS.COURT_METRICS(courtA._id.toString()));
  check('Court Alpha metrics hash exists in Redis', Object.keys(courtAMetrics).length > 0);
  check('Court Alpha metrics has JSI', parseFloat(courtAMetrics.justice_speed_index) > 0);

  // ── 6. System stats in Redis ──
  const sysStats = await redis.hgetall(REDIS_KEYS.SYSTEM_STATS);
  check('System stats stored in Redis', Object.keys(sysStats).length > 0);
  check('System stats has total_courts', parseInt(sysStats.total_courts) >= 3);

  // ── 7. Last refresh timestamp set ──
  const lastRefresh = await redis.get(REDIS_KEYS.LAST_REFRESH);
  check('Last refresh timestamp set in Redis', !!lastRefresh);

  // ── 8. Court model counters updated ──
  console.log('\n   --- Court Model Updates ---');
  const updatedCourtA = await Court.findById(courtA._id).lean();
  check('Court Alpha total_cases_filed updated to 10', updatedCourtA.total_cases_filed === 10);
  check('Court Alpha total_cases_resolved updated to 8', updatedCourtA.total_cases_resolved === 8);

  // ── 9. getLeaderboard reads from cache ──
  console.log('\n   --- Cache Read ---');
  const cached = await getLeaderboard();
  check('getLeaderboard returns from cache', cached.fromCache === true);
  check('Cached leaderboard has courts', cached.leaderboard.length >= 3);

  // ── 10. State filter works ──
  const filtered = await getLeaderboard({ state: 'Test State' });
  check('State filter returns our test courts', filtered.leaderboard.length >= 3);

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`   📋 Test Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════\n');

  return { passed, failed };
}

async function cleanup() {
  console.log('🧹 Cleaning up test data...');
  const redis = getRedis();

  // Clean Redis
  for (const courtId of testIds.courts) {
    await redis.del(REDIS_KEYS.COURT_METRICS(courtId.toString()));
    await redis.zrem(REDIS_KEYS.LEADERBOARD, courtId.toString());
  }
  // Note: don't delete system stats or leaderboard key entirely
  // since other courts may exist

  // Clean MongoDB
  await Case.deleteMany({ _id: { $in: testIds.cases } });
  await Court.deleteMany({ _id: { $in: testIds.courts } });
  await User.deleteMany({ _id: { $in: testIds.users } });

  console.log('   ✅ All test data cleaned up\n');
}

// ── Main ──
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🧪 Stage 12 Test — Leaderboard & Analytics Engine');
  console.log('═══════════════════════════════════════════════════');

  try {
    await connectDB();
    await connectRedis();

    const testData = await setup();
    const result = await runComputation();
    const results = await verify(testData, result);
    await cleanup();

    if (results.failed > 0) {
      console.log('❌ Some tests FAILED. Check output above.');
      process.exit(1);
    } else {
      console.log('✅ All Stage 12 tests PASSED!');
      process.exit(0);
    }
  } catch (err) {
    console.error('💥 Test error:', err);
    await cleanup().catch(() => {});
    process.exit(1);
  } finally {
    await disconnectRedis();
    await closeDB();
  }
}

main();
