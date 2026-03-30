// ============================================================
// Stage 10 Test — Delay Detection Engine
// ============================================================
// Creates test cases with old dates, runs the delay detection
// worker, and verifies:
//   1. delay_risk_score updated in MongoDB
//   2. Case IDs added to correct Redis delay sets
//   3. Alerts created for affected victims
//   4. Stagnation flag set for critical cases
//
// Usage: node src/tests/testDelayDetection.js
// ============================================================
const mongoose = require('mongoose');
const env = require('../config/env');
const { connectDB, closeDB } = require('../config/database');
const { connectRedis, disconnectRedis, getRedis } = require('../config/redis');
const Case = require('../models/Case');
const Alert = require('../models/Alert');
const Court = require('../models/Court');
const User = require('../models/User');
const { runDelayDetection } = require('../workers/delayDetection');

// Helper: days ago
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// Test IDs to clean up
const testIds = { users: [], courts: [], cases: [] };

async function setup() {
  console.log('\n🔧 Setting up test data...\n');

  // Create a test court
  const court = await Court.create({
    court_name: 'Test Delay Court',
    court_type: 'district',
    district: 'Test District',
    state: 'Test State',
    pin_code: '000000',
  });
  testIds.courts.push(court._id);
  console.log(`   ✅ Court created: ${court._id}`);

  // Create a test victim user
  const user = await User.create({
    full_name: 'Test Victim',
    email: `testvictim_${Date.now()}@test.com`,
    phone: '9999999999',
    password_hash: '$2a$10$testhashedpassword',
    role: 'victim',
    verification_status: 'otp_verified',
  });
  testIds.users.push(user._id);
  console.log(`   ✅ User created: ${user._id}`);

  // Case 1: 35 days old → should be WARNING (score 3-5)
  const case1 = await Case.create({
    cnr_number: `TEST-WARN-${Date.now()}`,
    case_type: 'fraud',
    court: court._id,
    victim_user: user._id,
    filing_date: daysAgo(100),
    last_update: daysAgo(35),
    current_status: 'hearing',
  });
  testIds.cases.push(case1._id);
  console.log(`   ✅ Case 1 (35d old): ${case1._id} — expecting WARNING`);

  // Case 2: 70 days old → should be HIGH RISK (score 6-8)
  const case2 = await Case.create({
    cnr_number: `TEST-HIGH-${Date.now()}`,
    case_type: 'theft',
    court: court._id,
    victim_user: user._id,
    filing_date: daysAgo(200),
    last_update: daysAgo(70),
    current_status: 'evidence',
  });
  testIds.cases.push(case2._id);
  console.log(`   ✅ Case 2 (70d old): ${case2._id} — expecting HIGH RISK`);

  // Case 3: 120 days old → should be CRITICAL (score 9-10) + stagnation
  const case3 = await Case.create({
    cnr_number: `TEST-CRIT-${Date.now()}`,
    case_type: 'domestic_violence',
    court: court._id,
    victim_user: user._id,
    filing_date: daysAgo(300),
    last_update: daysAgo(120),
    current_status: 'filed',
  });
  testIds.cases.push(case3._id);
  console.log(`   ✅ Case 3 (120d old): ${case3._id} — expecting CRITICAL + stagnation`);

  // Case 4: 10 days old → should have NO delay
  const case4 = await Case.create({
    cnr_number: `TEST-SAFE-${Date.now()}`,
    case_type: 'cybercrime',
    court: court._id,
    victim_user: user._id,
    filing_date: daysAgo(30),
    last_update: daysAgo(10),
    current_status: 'hearing',
  });
  testIds.cases.push(case4._id);
  console.log(`   ✅ Case 4 (10d old): ${case4._id} — expecting NO delay`);

  return { court, user, cases: [case1, case2, case3, case4] };
}

async function runTest() {
  console.log('\n🚀 Running delay detection scan...\n');
  const summary = await runDelayDetection();
  console.log('\n📊 Scan Summary:', JSON.stringify(summary, null, 2));
  return summary;
}

async function verify(testData) {
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

  // Reload cases from DB
  const [case1, case2, case3, case4] = await Promise.all(
    testIds.cases.map(id => Case.findById(id).lean())
  );

  // 1. Check delay_risk_score updated correctly
  check('Case 1 (35d) score in WARNING range (3-5)', case1.delay_risk_score >= 3 && case1.delay_risk_score <= 5);
  check('Case 2 (70d) score in HIGH range (6-8)', case2.delay_risk_score >= 6 && case2.delay_risk_score <= 8);
  check('Case 3 (120d) score in CRITICAL range (9-10)', case3.delay_risk_score >= 9 && case3.delay_risk_score <= 10);
  check('Case 4 (10d) score is 0 (no delay)', case4.delay_risk_score === 0);

  // 2. Check stagnation flag
  check('Case 3 stagnation_flag is TRUE', case3.stagnation_flag === true);
  check('Case 1 stagnation_flag is FALSE', case1.stagnation_flag === false);

  // 3. Check Redis delay sets
  const warningSet = await redis.smembers('delay:warning');
  const highRiskSet = await redis.smembers('delay:high_risk');
  const criticalSet = await redis.smembers('delay:critical');

  check('Case 1 is in delay:warning set', warningSet.includes(testIds.cases[0].toString()));
  check('Case 2 is in delay:high_risk set', highRiskSet.includes(testIds.cases[1].toString()));
  check('Case 3 is in delay:critical set', criticalSet.includes(testIds.cases[2].toString()));
  check('Case 4 is NOT in any delay set',
    !warningSet.includes(testIds.cases[3].toString()) &&
    !highRiskSet.includes(testIds.cases[3].toString()) &&
    !criticalSet.includes(testIds.cases[3].toString())
  );

  // 4. Check alerts created
  const alerts = await Alert.find({
    case: { $in: testIds.cases },
    alert_type: { $in: ['delay_warning', 'delay_high_risk', 'delay_critical'] },
  }).lean();

  check('Alerts created for delayed cases (at least 3)', alerts.length >= 3);

  const alertTypes = alerts.map(a => a.alert_type);
  check('Has delay_warning alert', alertTypes.includes('delay_warning'));
  check('Has delay_high_risk alert', alertTypes.includes('delay_high_risk'));
  check('Has delay_critical alert', alertTypes.includes('delay_critical'));

  // Summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`   📋 Test Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════\n');

  return { passed, failed };
}

async function cleanup() {
  console.log('🧹 Cleaning up test data...');
  const redis = getRedis();

  // Remove test cases from Redis delay sets
  for (const caseId of testIds.cases) {
    await redis.srem('delay:warning', caseId.toString());
    await redis.srem('delay:high_risk', caseId.toString());
    await redis.srem('delay:critical', caseId.toString());
    await redis.del(`case:${caseId}:info`);
    await redis.del(`case:${caseId}:status`);
    await redis.del(`case:${caseId}:last_update`);
    await redis.del(`case:${caseId}:next_hearing`);
    await redis.del(`case:${caseId}:adjournment_count`);
  }

  // Delete from MongoDB
  await Alert.deleteMany({ case: { $in: testIds.cases } });
  await Case.deleteMany({ _id: { $in: testIds.cases } });
  await Court.deleteMany({ _id: { $in: testIds.courts } });
  await User.deleteMany({ _id: { $in: testIds.users } });

  console.log('   ✅ All test data cleaned up\n');
}

// ── Main ──
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🧪 Stage 10 Test — Delay Detection Engine');
  console.log('═══════════════════════════════════════════════════');

  try {
    await connectDB();
    await connectRedis();

    const testData = await setup();
    await runTest();
    const results = await verify(testData);
    await cleanup();

    if (results.failed > 0) {
      console.log('❌ Some tests FAILED. Check output above.');
      process.exit(1);
    } else {
      console.log('✅ All Stage 10 tests PASSED!');
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
