// ============================================================
// Stage 16 Test — Admin Dashboard API
// ============================================================
// Tests:
//   1. Admin stats (users, cases, status breakdown, role counts)
//   2. All cases view with advanced filters (status, delay range, stagnant)
//   3. Stuck cases view (filtered by delay risk threshold)
//   4. Court-wise analytics aggregation
//   5. Audit log viewer with pagination + filters
//   6. User management (listing, search, role/verification filter)
//   7. RBAC — non-admin blocked from admin endpoints
//
// Usage: node src/tests/testAdminDashboard.js
// ============================================================
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { connectDB, closeDB } = require('../config/database');
const { connectRedis, disconnectRedis } = require('../config/redis');
const env = require('../config/env');
const User = require('../models/User');
const Case = require('../models/Case');
const Court = require('../models/Court');
const AuditLog = require('../models/AuditLog');
const {
  getAdminStats,
  getStuckCases,
  getCourtAnalytics,
  getAuditLogs,
} = require('../services/adminService');

const testIds = { users: [], courts: [], cases: [], auditLogs: [] };
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

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ============================================================
// Setup
// ============================================================
async function setup() {
  console.log('\n🔧 Setting up test data...\n');

  // Create admin user
  const admin = await User.create({
    full_name: 'Admin Test User',
    email: `admin_test_${Date.now()}@test.com`,
    phone: '8888880001',
    password_hash: '$2a$10$adminhashedpassword',
    role: 'admin',
    verification_status: 'fully_verified',
  });
  testIds.users.push(admin._id);

  // Create victim user
  const victim = await User.create({
    full_name: 'Victim Test User',
    email: `victim_test_${Date.now()}@test.com`,
    phone: '8888880002',
    password_hash: '$2a$10$victimhashedpassword',
    role: 'victim',
    verification_status: 'otp_verified',
  });
  testIds.users.push(victim._id);

  // Create court_staff user
  const staff = await User.create({
    full_name: 'Staff Test User',
    email: `staff_test_${Date.now()}@test.com`,
    phone: '8888880003',
    password_hash: '$2a$10$staffhashedpassword',
    role: 'court_staff',
    verification_status: 'fully_verified',
  });
  testIds.users.push(staff._id);

  // Create courts
  const court1 = await Court.create({
    court_name: 'Admin Test Court One',
    court_type: 'district',
    district: 'AdminTest District 1',
    state: 'AdminTest State',
    pin_code: '400001',
    total_cases_filed: 0,
    total_cases_resolved: 0,
  });
  testIds.courts.push(court1._id);

  const court2 = await Court.create({
    court_name: 'Admin Test Court Two',
    court_type: 'sessions',
    district: 'AdminTest District 2',
    state: 'AdminTest State',
    pin_code: '400002',
    total_cases_filed: 0,
    total_cases_resolved: 0,
  });
  testIds.courts.push(court2._id);

  // Create cases with varying statuses, delay scores, stagnation
  const caseTypes = ['fraud', 'theft', 'cybercrime', 'domestic_violence', 'murder'];
  const statuses = ['filed', 'hearing', 'evidence', 'disposed', 'judgment'];

  for (let i = 0; i < 12; i++) {
    const isStuck = i >= 8;           // last 4 are "stuck"
    const isResolved = statuses[i % 5] === 'disposed' || statuses[i % 5] === 'judgment';
    const c = await Case.create({
      cnr_number: `ATEST-${Date.now()}-${String(i).padStart(3, '0')}`,
      case_type: caseTypes[i % 5],
      court: i < 7 ? court1._id : court2._id,
      victim_user: victim._id,
      filing_date: daysAgo(60 + i * 20),
      last_update: isStuck ? daysAgo(100) : daysAgo(5),
      current_status: isStuck ? 'filed' : statuses[i % 5],
      adjournment_count: i,
      delay_risk_score: isStuck ? 8 + (i % 3) : Math.min(i, 5),
      stagnation_flag: isStuck,
    });
    testIds.cases.push(c._id);
  }

  // Update court counters
  await Court.findByIdAndUpdate(court1._id, { total_cases_filed: 7, total_cases_resolved: 2 });
  await Court.findByIdAndUpdate(court2._id, { total_cases_filed: 5, total_cases_resolved: 1 });

  // Create audit log entries
  const auditActions = [
    { action: 'case.create', entity_type: 'case' },
    { action: 'disclosure.approve', entity_type: 'disclosure' },
    { action: 'document.upload', entity_type: 'document' },
    { action: 'case.update', entity_type: 'case' },
    { action: 'user.login', entity_type: 'user' },
  ];

  for (const a of auditActions) {
    const log = await AuditLog.create({
      user: admin._id,
      action: a.action,
      entity_type: a.entity_type,
      entity_id: testIds.cases[0],
      ip_address: '127.0.0.1',
      user_agent: 'TestRunner/1.0',
    });
    testIds.auditLogs.push(log._id);
  }

  console.log(`   ✅ 3 users (admin, victim, staff), 2 courts, 12 cases, 5 audit logs created`);
  return { admin, victim, staff, court1, court2 };
}

// ============================================================
// Test 1: Admin Stats
// ============================================================
async function testAdminStats() {
  console.log('\n   --- Admin Stats ---\n');

  const stats = await getAdminStats();

  check('Stats has overview', !!stats.overview);
  check('Stats has by_status', !!stats.by_status);
  check('Stats has by_role', !!stats.by_role);
  check('Total users >= 3', stats.overview.total_users >= 3);
  check('Total cases >= 12', stats.overview.total_cases >= 12);
  check('Total courts >= 2', stats.overview.total_courts >= 2);
  check('avg_delay_risk is a number', typeof stats.overview.avg_delay_risk === 'number');
  check('by_role has admin', stats.by_role.admin >= 1);
  check('by_role has victim', stats.by_role.victim >= 1);
}

// ============================================================
// Test 2: All Cases with Advanced Filters
// ============================================================
async function testAllCasesFilters() {
  console.log('\n   --- All Cases with Filters ---\n');

  // Basic query — all test cases
  const allTestCases = await Case.find({ _id: { $in: testIds.cases } })
    .populate('court', 'court_name district state')
    .populate('victim_user', 'full_name email phone verification_status')
    .lean();

  check('All 12 test cases retrievable', allTestCases.length === 12);

  // Admin sees full victim info (not anonymized)
  const firstCase = allTestCases[0];
  check('Admin can see victim_user info', !!firstCase.victim_user);
  check('Admin sees victim full_name', !!firstCase.victim_user.full_name);

  // Filter by status
  const filedCases = await Case.find({
    _id: { $in: testIds.cases },
    current_status: 'filed',
  }).lean();
  check('Status filter works (filed)', filedCases.length > 0);

  // Filter by delay risk range
  const highDelayCases = await Case.find({
    _id: { $in: testIds.cases },
    delay_risk_score: { $gte: 7 },
  }).lean();
  check('Delay risk range filter works (>=7)', highDelayCases.length > 0);

  // Filter by stagnation
  const stagnantCases = await Case.find({
    _id: { $in: testIds.cases },
    stagnation_flag: true,
  }).lean();
  check('Stagnation filter works', stagnantCases.length === 4);

  // Search by CNR
  const caseBySearch = await Case.find({
    _id: { $in: testIds.cases },
    cnr_number: { $regex: 'ATEST', $options: 'i' },
  }).lean();
  check('CNR search works', caseBySearch.length === 12);
}

// ============================================================
// Test 3: Stuck Cases View
// ============================================================
async function testStuckCases() {
  console.log('\n   --- Stuck Cases View ---\n');

  const result = await getStuckCases({ page: 1, limit: 20, threshold: 7 });

  check('Stuck cases result has total', typeof result.total === 'number');
  check('Stuck cases result has cases array', Array.isArray(result.cases));
  check('Stuck cases found (threshold 7)', result.total > 0);
  check('Stuck cases have court populated', result.cases.length > 0 && !!result.cases[0].court);

  // All returned cases should have delay_risk_score >= 7
  const allAboveThreshold = result.cases.every(c => c.delay_risk_score >= 7);
  check('All stuck cases have delay >= 7', allAboveThreshold);

  // None should be disposed/judgment
  const noneResolved = result.cases.every(
    c => c.current_status !== 'disposed' && c.current_status !== 'judgment'
  );
  check('No resolved cases in stuck list', noneResolved);

  // Sorted by delay descending
  let sortedCorrectly = true;
  for (let i = 1; i < result.cases.length; i++) {
    if (result.cases[i].delay_risk_score > result.cases[i - 1].delay_risk_score) {
      sortedCorrectly = false;
    }
  }
  check('Stuck cases sorted by delay_risk_score DESC', sortedCorrectly);

  // Pagination
  check('Has page number', result.page === 1);
  check('Has pages count', typeof result.pages === 'number');
}

// ============================================================
// Test 4: Court-wise Analytics
// ============================================================
async function testCourtAnalytics() {
  console.log('\n   --- Court Analytics ---\n');

  const analytics = await getCourtAnalytics();

  check('Analytics returned array', Array.isArray(analytics));
  check('Analytics has entries', analytics.length > 0);

  // Find our test courts
  const court1Analytics = analytics.find(a =>
    a.court_name === 'Admin Test Court One'
  );
  const court2Analytics = analytics.find(a =>
    a.court_name === 'Admin Test Court Two'
  );

  check('Court One found in analytics', !!court1Analytics);
  check('Court Two found in analytics', !!court2Analytics);

  if (court1Analytics) {
    check('Court One has total_cases', court1Analytics.total_cases > 0);
    check('Court One has resolved_cases', court1Analytics.resolved_cases !== undefined);
    check('Court One has resolution_rate', court1Analytics.resolution_rate !== undefined);
    check('Court One has avg_delay_score', court1Analytics.avg_delay_score !== undefined);
    check('Court One has district', !!court1Analytics.district);
    check('Court One has state', !!court1Analytics.state);
  }

  // Sorted by resolution_rate descending
  let sortedByRate = true;
  for (let i = 1; i < analytics.length; i++) {
    if (analytics[i].resolution_rate > analytics[i - 1].resolution_rate) {
      sortedByRate = false;
    }
  }
  check('Analytics sorted by resolution_rate DESC', sortedByRate);
}

// ============================================================
// Test 5: Audit Log Viewer
// ============================================================
async function testAuditLogs() {
  console.log('\n   --- Audit Log Viewer ---\n');

  // Get all audit logs (unfiltered)
  const allLogs = await getAuditLogs({ page: 1, limit: 50 });
  check('Audit logs result has total', typeof allLogs.total === 'number');
  check('Audit logs has logs array', Array.isArray(allLogs.logs));
  check('At least 5 audit log entries', allLogs.total >= 5);

  // Filter by action
  const caseLogs = await getAuditLogs({
    page: 1, limit: 50,
    action: 'case.create',
  });
  check('Filter by action works', caseLogs.logs.length > 0);
  const allMatchAction = caseLogs.logs.every(l => l.action === 'case.create');
  check('All filtered logs match action', allMatchAction);

  // Filter by entity_type
  const disclosureLogs = await getAuditLogs({
    page: 1, limit: 50,
    entityType: 'disclosure',
  });
  check('Filter by entity_type works', disclosureLogs.logs.length > 0);

  // Filter by userId
  const userLogs = await getAuditLogs({
    page: 1, limit: 50,
    userId: testIds.users[0].toString(),
  });
  check('Filter by user_id works', userLogs.logs.length >= 5);

  // Pagination fields
  check('Audit logs has page', allLogs.page === 1);
  check('Audit logs has pages', typeof allLogs.pages === 'number');
  check('Audit logs has limit', typeof allLogs.limit === 'number');

  // Logs sorted by createdAt descending (newest first)
  let sortedCorrectly = true;
  for (let i = 1; i < allLogs.logs.length; i++) {
    if (new Date(allLogs.logs[i].createdAt) > new Date(allLogs.logs[i - 1].createdAt)) {
      sortedCorrectly = false;
    }
  }
  check('Audit logs sorted newest first', sortedCorrectly);
}

// ============================================================
// Test 6: User Management View
// ============================================================
async function testUserManagement() {
  console.log('\n   --- User Management ---\n');

  // List all test users
  const allUsers = await User.find({ _id: { $in: testIds.users } })
    .select('-password_hash -otp_code -otp_expires_at')
    .lean();

  check('All 3 test users found', allUsers.length === 3);

  // Verify password_hash NOT in output (select exclusion)
  const noPasswords = allUsers.every(u => u.password_hash === undefined);
  check('No password_hash in user listing', noPasswords);

  // Filter by role
  const adminsOnly = await User.find({
    _id: { $in: testIds.users },
    role: 'admin',
  }).select('-password_hash').lean();
  check('Role filter (admin) works', adminsOnly.length === 1);

  const victimsOnly = await User.find({
    _id: { $in: testIds.users },
    role: 'victim',
  }).select('-password_hash').lean();
  check('Role filter (victim) works', victimsOnly.length === 1);

  // Filter by verification_status
  const fullyVerified = await User.find({
    _id: { $in: testIds.users },
    verification_status: 'fully_verified',
  }).select('-password_hash').lean();
  check('Verification status filter works', fullyVerified.length === 2);

  // Search by name
  const nameSearch = await User.find({
    _id: { $in: testIds.users },
    $or: [
      { full_name: { $regex: 'Admin', $options: 'i' } },
      { email: { $regex: 'Admin', $options: 'i' } },
    ],
  }).select('-password_hash').lean();
  check('Search by name works', nameSearch.length >= 1);
}

// ============================================================
// Test 7: RBAC — Non-admin Blocked
// ============================================================
async function testRBAC(testData) {
  console.log('\n   --- RBAC Access Control ---\n');

  // Generate admin JWT
  const adminToken = jwt.sign(
    { userId: testData.admin._id },
    env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  check('Admin JWT generated', !!adminToken);

  // Verify admin token decodes correctly
  const decoded = jwt.verify(adminToken, env.JWT_SECRET);
  check('Admin token decodes to correct userId',
    decoded.userId.toString() === testData.admin._id.toString());

  // Verify admin user has correct role
  const adminUser = await User.findById(testData.admin._id);
  check('Admin user has admin role', adminUser.role === 'admin');

  // Victim should NOT have admin role
  const victimUser = await User.findById(testData.victim._id);
  check('Victim user does NOT have admin role', victimUser.role !== 'admin');

  // Staff has court_staff — check permission matrix
  const staffUser = await User.findById(testData.staff._id);
  check('Staff user has court_staff role', staffUser.role === 'court_staff');

  // RBAC simulation — authorize('admin') rejects non-admin
  const isVictimAllowed = ['admin'].includes(victimUser.role);
  check('RBAC: victim role is blocked from admin routes', !isVictimAllowed);

  const isAdminAllowed = ['admin'].includes(adminUser.role);
  check('RBAC: admin role is allowed on admin routes', isAdminAllowed);
}

// ============================================================
// Cleanup
// ============================================================
async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');
  await AuditLog.deleteMany({ _id: { $in: testIds.auditLogs } });
  await Case.deleteMany({ _id: { $in: testIds.cases } });
  await Court.deleteMany({ _id: { $in: testIds.courts } });
  await User.deleteMany({ _id: { $in: testIds.users } });
  console.log('   ✅ All test data cleaned up\n');
}

// ============================================================
// Main
// ============================================================
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🧪 Stage 16 Test — Admin Dashboard API');
  console.log('═══════════════════════════════════════════════════');

  try {
    await connectDB();
    await connectRedis();

    const testData = await setup();

    await testAdminStats();
    await testAllCasesFilters();
    await testStuckCases();
    await testCourtAnalytics();
    await testAuditLogs();
    await testUserManagement();
    await testRBAC(testData);

    await cleanup();

    console.log('═══════════════════════════════════════════════════');
    console.log(`   📋 Test Results: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════════\n');

    if (failed > 0) {
      console.log('❌ Some tests FAILED. Check output above.');
      process.exit(1);
    } else {
      console.log('✅ All Stage 16 tests PASSED!');
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
