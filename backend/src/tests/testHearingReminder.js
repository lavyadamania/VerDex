// ============================================================
// Stage 11 Test — Hearing Reminder & Alert System
// ============================================================
// Creates test cases with upcoming hearing dates, runs the
// hearing reminder worker, and verifies:
//   1. 3-day reminder alerts created
//   2. 1-day reminder alerts created
//   3. Alert CRUD operations (get, mark read, mark all read, dismiss)
//   4. Deduplication (no duplicate alerts within window)
//   5. Unread count accurate
//
// Usage: node src/tests/testHearingReminder.js
// ============================================================
const mongoose = require('mongoose');
const env = require('../config/env');
const { connectDB, closeDB } = require('../config/database');
const { connectRedis, disconnectRedis, getRedis } = require('../config/redis');
const Case = require('../models/Case');
const Alert = require('../models/Alert');
const Court = require('../models/Court');
const User = require('../models/User');
const { runHearingReminderScan } = require('../workers/hearingReminder');
const {
  getUserAlerts,
  markAlertRead,
  markAllAlertsRead,
  dismissAlert,
  getUnreadCount,
} = require('../services/alertService');

// Helper: days from now
function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// Test IDs to clean up
const testIds = { users: [], courts: [], cases: [], alerts: [] };

async function setup() {
  console.log('\n🔧 Setting up test data...\n');

  // Create a test court
  const court = await Court.create({
    court_name: 'Test Reminder Court',
    court_type: 'district',
    district: 'Reminder District',
    state: 'Test State',
    pin_code: '111111',
  });
  testIds.courts.push(court._id);
  console.log(`   ✅ Court created: ${court._id}`);

  // Create a test victim user
  const user = await User.create({
    full_name: 'Test Reminder Victim',
    email: `testreminder_${Date.now()}@test.com`,
    phone: '8888888888',
    password_hash: '$2a$10$testhashedpassword',
    role: 'victim',
    verification_status: 'otp_verified',
  });
  testIds.users.push(user._id);
  console.log(`   ✅ User created: ${user._id}`);

  // Case 1: Hearing in 3 days → should get 3-day reminder
  const case1 = await Case.create({
    cnr_number: `TEST-3DAY-${Date.now()}`,
    case_type: 'fraud',
    court: court._id,
    victim_user: user._id,
    filing_date: daysAgo(60),
    last_update: new Date(),
    next_hearing_date: daysFromNow(3),
    current_status: 'hearing',
  });
  testIds.cases.push(case1._id);
  console.log(`   ✅ Case 1 (hearing in 3 days): ${case1._id}`);

  // Case 2: Hearing in 1 day → should get 1-day reminder
  const case2 = await Case.create({
    cnr_number: `TEST-1DAY-${Date.now()}`,
    case_type: 'theft',
    court: court._id,
    victim_user: user._id,
    filing_date: daysAgo(90),
    last_update: new Date(),
    next_hearing_date: daysFromNow(1),
    current_status: 'evidence',
  });
  testIds.cases.push(case2._id);
  console.log(`   ✅ Case 2 (hearing in 1 day): ${case2._id}`);

  // Case 3: Hearing in 10 days → should NOT get a reminder
  const case3 = await Case.create({
    cnr_number: `TEST-10DAY-${Date.now()}`,
    case_type: 'cybercrime',
    court: court._id,
    victim_user: user._id,
    filing_date: daysAgo(30),
    last_update: new Date(),
    next_hearing_date: daysFromNow(10),
    current_status: 'hearing',
  });
  testIds.cases.push(case3._id);
  console.log(`   ✅ Case 3 (hearing in 10 days): ${case3._id} — NO reminder expected`);

  // Case 4: Disposed case with hearing date → should NOT get a reminder
  const case4 = await Case.create({
    cnr_number: `TEST-DISPOSED-${Date.now()}`,
    case_type: 'domestic_violence',
    court: court._id,
    victim_user: user._id,
    filing_date: daysAgo(200),
    last_update: new Date(),
    next_hearing_date: daysFromNow(1),
    current_status: 'disposed',
  });
  testIds.cases.push(case4._id);
  console.log(`   ✅ Case 4 (disposed, hearing in 1 day): ${case4._id} — NO reminder expected`);

  return { court, user, cases: [case1, case2, case3, case4] };
}

async function runWorkerTest() {
  console.log('\n🚀 Running hearing reminder scan...\n');
  const summary = await runHearingReminderScan();
  console.log('\n📊 Scan Summary:', JSON.stringify(summary, null, 2));
  return summary;
}

async function verify(testData) {
  console.log('\n🔍 Verifying results...\n');
  const userId = testData.user._id;
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

  // ── 1. Check hearing reminder alerts were created ──
  console.log('\n   --- Worker Alerts ---');

  const case1Alerts = await Alert.find({
    case: testIds.cases[0],
    alert_type: 'hearing_reminder',
  }).lean();
  check('Case 1 (3-day) got a hearing reminder', case1Alerts.length >= 1);

  const case2Alerts = await Alert.find({
    case: testIds.cases[1],
    alert_type: 'hearing_reminder',
  }).lean();
  check('Case 2 (1-day) got a hearing reminder', case2Alerts.length >= 1);

  // Case 2 should have high severity (1-day reminder)
  if (case2Alerts.length > 0) {
    check('Case 2 alert severity is "high"', case2Alerts[0].severity === 'high');
  }

  const case3Alerts = await Alert.find({
    case: testIds.cases[2],
    alert_type: 'hearing_reminder',
  }).lean();
  check('Case 3 (10-day) did NOT get a reminder', case3Alerts.length === 0);

  const case4Alerts = await Alert.find({
    case: testIds.cases[3],
    alert_type: 'hearing_reminder',
  }).lean();
  check('Case 4 (disposed) did NOT get a reminder', case4Alerts.length === 0);

  // ── 2. Test deduplication ──
  console.log('\n   --- Deduplication ---');
  const summary2 = await runHearingReminderScan();
  check('Second scan creates 0 new alerts (deduped)', summary2.alerts_created === 0);

  // ── 3. Test Alert CRUD Service ──
  console.log('\n   --- Alert CRUD ---');

  // getUserAlerts
  const alertResult = await getUserAlerts(userId, { page: 1, limit: 10 });
  check('getUserAlerts returns alerts', alertResult.alerts.length >= 2);
  check('getUserAlerts has pagination', alertResult.pagination.total >= 2);
  check('getUserAlerts has unreadCount', alertResult.unreadCount >= 2);

  // getUnreadCount
  const unread = await getUnreadCount(userId);
  check('getUnreadCount returns correct count', unread >= 2);

  // markAlertRead
  const firstAlertId = alertResult.alerts[0]._id;
  const markedAlert = await markAlertRead(firstAlertId, userId);
  check('markAlertRead returns updated alert', markedAlert !== null);
  check('markAlertRead sets is_read = true', markedAlert.is_read === true);

  // Verify unread count decreased
  const unreadAfterMarkOne = await getUnreadCount(userId);
  check('Unread count decreased by 1 after markAlertRead', unreadAfterMarkOne === unread - 1);

  // markAllAlertsRead
  const markedCount = await markAllAlertsRead(userId);
  check('markAllAlertsRead returns count > 0', markedCount >= 1);

  const unreadAfterMarkAll = await getUnreadCount(userId);
  check('Unread count is 0 after markAllAlertsRead', unreadAfterMarkAll === 0);

  // dismissAlert
  const secondAlertId = alertResult.alerts[1]._id;
  const dismissed = await dismissAlert(secondAlertId, userId);
  check('dismissAlert returns updated alert', dismissed !== null);
  check('dismissAlert sets is_dismissed = true', dismissed.is_dismissed === true);

  // Verify dismissed alert doesn't appear in getUserAlerts
  const alertsAfterDismiss = await getUserAlerts(userId, { page: 1, limit: 10 });
  const dismissedIds = alertsAfterDismiss.alerts.map(a => a._id.toString());
  check('Dismissed alert excluded from getUserAlerts', !dismissedIds.includes(secondAlertId.toString()));

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`   📋 Test Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════\n');

  return { passed, failed };
}

async function cleanup() {
  console.log('🧹 Cleaning up test data...');

  // Delete alerts for test cases
  await Alert.deleteMany({ case: { $in: testIds.cases } });
  // Delete test cases
  await Case.deleteMany({ _id: { $in: testIds.cases } });
  // Delete test courts
  await Court.deleteMany({ _id: { $in: testIds.courts } });
  // Delete test users
  await User.deleteMany({ _id: { $in: testIds.users } });

  // Clean Redis
  const redis = getRedis();
  await redis.del('hearing_reminder:last_scan');
  await redis.del('hearing_reminder:last_scan_at');

  console.log('   ✅ All test data cleaned up\n');
}

// ── Main ──
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🧪 Stage 11 Test — Hearing Reminder & Alert System');
  console.log('═══════════════════════════════════════════════════');

  try {
    await connectDB();
    await connectRedis();

    const testData = await setup();
    await runWorkerTest();
    const results = await verify(testData);
    await cleanup();

    if (results.failed > 0) {
      console.log('❌ Some tests FAILED. Check output above.');
      process.exit(1);
    } else {
      console.log('✅ All Stage 11 tests PASSED!');
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
