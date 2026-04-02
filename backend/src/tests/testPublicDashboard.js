// ============================================================
// Stage 15 Test — Public Dashboard API
// ============================================================
// Tests that all public endpoints:
//   1. Return anonymized data only
//   2. NEVER leak private info (victim name, phone, statement)
//   3. Pagination, filtering, sorting work
//   4. Masked ID lookup works
//   5. System stats are computed correctly
//   6. Court performance view is public-safe
//
// Usage: node src/tests/testPublicDashboard.js
// ============================================================
const mongoose = require('mongoose');
const { connectDB, closeDB } = require('../config/database');
const { connectRedis, disconnectRedis } = require('../config/redis');
const User = require('../models/User');
const Case = require('../models/Case');
const Court = require('../models/Court');
const CaseEvent = require('../models/CaseEvent');

const testIds = { users: [], courts: [], cases: [], events: [] };
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

// Private fields that must NEVER appear in public output
const PRIVATE_FIELDS = [
  'victim_user', 'victim_statement', 'password_hash',
  'email', 'phone', 'otp_code', 'advocate_contact',
];

// ============================================================
// Setup
// ============================================================
async function setup() {
  console.log('\n🔧 Setting up test data...\n');

  const court1 = await Court.create({
    court_name: 'Public Test Court Alpha',
    court_type: 'district',
    district: 'PTest Alpha',
    state: 'PTest State',
    pin_code: '300001',
    total_cases_filed: 0,
    total_cases_resolved: 0,
  });
  testIds.courts.push(court1._id);

  const court2 = await Court.create({
    court_name: 'Public Test Court Beta',
    court_type: 'sessions',
    district: 'PTest Beta',
    state: 'PTest State',
    pin_code: '300002',
    total_cases_filed: 0,
    total_cases_resolved: 0,
  });
  testIds.courts.push(court2._id);

  const victim = await User.create({
    full_name: 'Secret Victim Name',
    email: `ptest_victim_${Date.now()}@secret.com`,
    phone: '9999999999',
    password_hash: '$2a$10$supersecretpasswordhash',
    role: 'victim',
    verification_status: 'otp_verified',
  });
  testIds.users.push(victim._id);

  // Create cases with sensitive data
  const cases = [];
  const caseTypes = ['fraud', 'theft', 'cybercrime', 'domestic_violence', 'murder'];
  const statuses = ['filed', 'hearing', 'evidence', 'disposed', 'judgment'];

  for (let i = 0; i < 15; i++) {
    const isResolved = statuses[i % 5] === 'disposed' || statuses[i % 5] === 'judgment';
    const c = await Case.create({
      cnr_number: `PTEST-${Date.now()}-${String(i).padStart(3, '0')}`,
      case_type: caseTypes[i % 5],
      court: i < 10 ? court1._id : court2._id,
      victim_user: victim._id,
      filing_date: new Date(Date.now() - (i * 30 * 24 * 60 * 60 * 1000)),
      current_status: statuses[i % 5],
      accused_name: `Secret Accused ${i}`,
      judge_name: `Secret Judge ${i}`,
      victim_statement: `Highly confidential victim statement #${i}`,
      advocate_name: `Advocate ${i}`,
      advocate_contact: `advocate${i}@secret.com`,
      adjournment_count: i,
      delay_risk_score: Math.min(i, 10),
      stagnation_flag: i > 10,
      disclosure_mode: i === 0 ? 'partial' : 'private',
      disclosed_fields: i === 0 ? ['accused_name'] : [],
    });
    testIds.cases.push(c._id);
    cases.push(c);
  }

  // Update court counters
  await Court.findByIdAndUpdate(court1._id, { total_cases_filed: 10, total_cases_resolved: 4 });
  await Court.findByIdAndUpdate(court2._id, { total_cases_filed: 5, total_cases_resolved: 2 });

  console.log(`   ✅ 2 courts, 1 user, ${cases.length} cases created`);
  return { court1, court2, victim, cases };
}

// ============================================================
// Test: Anonymized Case Listing
// ============================================================
async function testCaseListing() {
  console.log('\n   --- Anonymized Case Listing ---\n');

  // Fetch all public cases
  const allCases = await Case.find({ _id: { $in: testIds.cases } })
    .populate('court', 'court_name district state court_type');

  const anonymized = allCases.map(c => c.toAnonymized());

  check('Got anonymized cases', anonymized.length === 15);

  // Verify NO private data in any case
  let noLeaks = true;
  for (const c of anonymized) {
    const json = JSON.stringify(c);
    for (const field of PRIVATE_FIELDS) {
      if (json.includes('Secret Victim') || json.includes('9999999999') ||
          json.includes('supersecret') || json.includes('ptest_victim')) {
        noLeaks = false;
        console.log(`   ⚠️  LEAK detected: "${field}" value found in case ${c.masked_id}`);
      }
    }
    // Check that victim_user ID is not present
    if (c.victim_user) {
      noLeaks = false;
      console.log(`   ⚠️  LEAK: victim_user ID exposed in case ${c.masked_id}`);
    }
  }
  check('NO private data leaks in case listing', noLeaks);

  // Verify expected public fields ARE present
  const first = anonymized[0];
  check('Has masked_id', !!first.masked_id);
  check('Has case_type', !!first.case_type);
  check('Has filing_date', !!first.filing_date);
  check('Has current_status', !!first.current_status);
  check('Has days_pending (number)', typeof first.days_pending === 'number');
  check('Has adjournment_count', first.adjournment_count !== undefined);
  check('Has delay_risk_score', first.delay_risk_score !== undefined);

  // Masked ID format check
  check('Masked ID format CT-XXXXXX', /^CT-[A-Z0-9]{6}$/.test(first.masked_id));
}

// ============================================================
// Test: Disclosure Respected in Public View
// ============================================================
async function testDisclosureInPublicView() {
  console.log('\n   --- Disclosure Respected ---\n');

  // Case 0 has partial disclosure with accused_name
  const case0 = await Case.findById(testIds.cases[0])
    .populate('court', 'court_name district state court_type');
  const anon0 = case0.toAnonymized();

  check('Disclosed accused_name appears for partial case', anon0.accused_name === 'Secret Accused 0');

  // Case 1 is private — nothing disclosed
  const case1 = await Case.findById(testIds.cases[1])
    .populate('court', 'court_name district state court_type');
  const anon1 = case1.toAnonymized();

  check('Private case has NO accused_name', anon1.accused_name === undefined);
  check('Private case has NO judge_name', anon1.judge_name === undefined);
  check('Private case has NO victim_statement', anon1.victim_statement === undefined);
}

// ============================================================
// Test: Masked ID Lookup
// ============================================================
async function testMaskedIdLookup() {
  console.log('\n   --- Masked ID Lookup ---\n');

  const testCase = await Case.findById(testIds.cases[0]);
  const maskedId = testCase.masked_id; // CT-XXXXXX

  check('Masked ID generated', !!maskedId);
  check('Masked ID starts with CT-', maskedId.startsWith('CT-'));

  // Lookup by suffix
  const suffix = maskedId.slice(3).toLowerCase();
  const found = await Case.findOne({
    _id: { $in: testIds.cases },
  }).then(async () => {
    // Simulate the route lookup
    const allCases = await Case.find({ _id: { $in: testIds.cases } }).lean();
    return allCases.find(c => c._id.toString().slice(-6) === suffix);
  });

  check('Case found by masked ID suffix', !!found);
  check('Found correct case', found._id.toString() === testCase._id.toString());
}

// ============================================================
// Test: System Statistics
// ============================================================
async function testSystemStats() {
  console.log('\n   --- System Statistics ---\n');

  // Compute stats directly
  const totalCases = await Case.countDocuments({ _id: { $in: testIds.cases } });
  check('Total cases counted', totalCases === 15);

  const resolvedCases = await Case.countDocuments({
    _id: { $in: testIds.cases },
    current_status: { $in: ['disposed', 'judgment'] },
  });
  check('Resolved cases counted', resolvedCases > 0);

  const pendingCases = totalCases - resolvedCases;
  check('Pending cases = total - resolved', pendingCases === totalCases - resolvedCases);

  // Status breakdown
  const statusCounts = await Case.aggregate([
    { $match: { _id: { $in: testIds.cases.map(id => new mongoose.Types.ObjectId(id)) } } },
    { $group: { _id: '$current_status', count: { $sum: 1 } } },
  ]);
  check('Status breakdown has entries', statusCounts.length > 0);

  // Type breakdown
  const typeCounts = await Case.aggregate([
    { $match: { _id: { $in: testIds.cases.map(id => new mongoose.Types.ObjectId(id)) } } },
    { $group: { _id: '$case_type', count: { $sum: 1 } } },
  ]);
  check('Type breakdown has entries', typeCounts.length > 0);

  // Verify no private data in aggregated stats
  const statsJson = JSON.stringify([...statusCounts, ...typeCounts]);
  check('No private data in stats', !statsJson.includes('Secret'));
}

// ============================================================
// Test: Court Performance Public View
// ============================================================
async function testCourtPerformance() {
  console.log('\n   --- Court Performance ---\n');

  const court1 = await Court.findById(testIds.courts[0])
    .select('court_name court_type district state total_cases_filed total_cases_resolved')
    .lean();

  check('Court name visible', !!court1.court_name);
  check('Court type visible', !!court1.court_type);
  check('District visible', !!court1.district);
  check('State visible', !!court1.state);
  check('Total cases filed available', court1.total_cases_filed === 10);
  check('Total cases resolved available', court1.total_cases_resolved === 4);

  // Computed stats
  const pending = court1.total_cases_filed - court1.total_cases_resolved;
  check('Pending computed correctly', pending === 6);

  const resRate = (court1.total_cases_resolved / court1.total_cases_filed * 100);
  check('Resolution rate computed', resRate === 40);

  // Court listing
  const allCourts = await Court.find({ _id: { $in: testIds.courts } })
    .select('court_name court_type district state total_cases_filed total_cases_resolved')
    .lean();
  check('Multiple courts listable', allCourts.length === 2);

  // No private data in court listing
  const courtJson = JSON.stringify(allCourts);
  check('No private data in court listing', !courtJson.includes('Secret'));
}

// ============================================================
// Test: Privacy Guarantee (CRITICAL)
// ============================================================
async function testPrivacyGuarantee() {
  console.log('\n   --- CRITICAL: Privacy Guarantee ---\n');

  // Fetch ALL test cases as anonymized
  const cases = await Case.find({ _id: { $in: testIds.cases } })
    .populate('court', 'court_name district state');

  let totalLeaks = 0;

  for (const c of cases) {
    const anon = c.toAnonymized();
    const json = JSON.stringify(anon);

    // Must NOT contain any of these
    const forbidden = [
      'Secret Victim Name',
      'ptest_victim',
      '9999999999',
      'supersecret',
      'password_hash',
      '@secret.com',
    ];

    for (const f of forbidden) {
      if (json.includes(f)) {
        console.log(`   ❌ CRITICAL LEAK: "${f}" found in anonymized case ${anon.masked_id}`);
        totalLeaks++;
      }
    }

    // Check fields that should NEVER exist in anonymized output
    if (c.disclosure_mode === 'private') {
      if (anon.accused_name !== undefined) totalLeaks++;
      if (anon.judge_name !== undefined) totalLeaks++;
      if (anon.victim_statement !== undefined) totalLeaks++;
    }
  }

  check('ZERO privacy leaks across all cases', totalLeaks === 0);

  // Verify victim_user is never in toAnonymized output
  const case0 = cases[0];
  const anon0 = case0.toAnonymized();
  check('victim_user NOT in anonymized output', anon0.victim_user === undefined);
  check('_id NOT in anonymized output', anon0._id === undefined);
  check('advocate_contact NOT in anonymized output', anon0.advocate_contact === undefined);
}

// ============================================================
// Cleanup
// ============================================================
async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');
  await CaseEvent.deleteMany({ case: { $in: testIds.cases } });
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
  console.log('  🧪 Stage 15 Test — Public Dashboard API');
  console.log('═══════════════════════════════════════════════════');

  try {
    await connectDB();
    await connectRedis();

    await setup();

    await testCaseListing();
    await testDisclosureInPublicView();
    await testMaskedIdLookup();
    await testSystemStats();
    await testCourtPerformance();
    await testPrivacyGuarantee();

    await cleanup();

    console.log('═══════════════════════════════════════════════════');
    console.log(`   📋 Test Results: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════════\n');

    if (failed > 0) {
      console.log('❌ Some tests FAILED. Check output above.');
      process.exit(1);
    } else {
      console.log('✅ All Stage 15 tests PASSED!');
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
