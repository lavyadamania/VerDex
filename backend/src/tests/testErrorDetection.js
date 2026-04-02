// ============================================================
// Stage 17 Test — Error Detection & Validation
// ============================================================
// Tests:
//   1. Date sequence errors (future filing, past hearing, disposed+future)
//   2. Impossible timeline (events before filing, hearing after judgment)
//   3. Status vs timeline mismatches (judgment status w/o event, filed w/ hearings)
//   4. Counter mismatches (adjournment/hearing count vs events)
//   5. Document-input mismatches (judgment doc vs status, missing docs)
//   6. Full case scan (all checks combined + alert generation)
//   7. Bulk scan-all + error summary stats
//
// Usage: node src/tests/testErrorDetection.js
// ============================================================
const mongoose = require('mongoose');
const { connectDB, closeDB } = require('../config/database');
const { connectRedis, disconnectRedis } = require('../config/redis');
const User = require('../models/User');
const Case = require('../models/Case');
const Court = require('../models/Court');
const CaseEvent = require('../models/CaseEvent');
const Document = require('../models/Document');
const Alert = require('../models/Alert');
const {
  checkDateSequences,
  checkImpossibleTimeline,
  checkStatusMismatch,
  checkCounterMismatch,
  checkDocumentMismatch,
  scanCaseForErrors,
  scanAllCasesForErrors,
  getErrorSummary,
} = require('../services/errorDetectionService');

const testIds = { users: [], courts: [], cases: [], events: [], docs: [], alerts: [] };
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

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

// ============================================================
// Setup
// ============================================================
async function setup() {
  console.log('\n🔧 Setting up test data...\n');

  // Create user
  const victim = await User.create({
    full_name: 'ErrTest Victim',
    email: `errtest_victim_${Date.now()}@test.com`,
    phone: '7777770001',
    password_hash: '$2a$10$hashedpassword',
    role: 'victim',
    verification_status: 'otp_verified',
  });
  testIds.users.push(victim._id);

  // Create court
  const court = await Court.create({
    court_name: 'ErrTest Court',
    court_type: 'district',
    district: 'ErrTest District',
    state: 'ErrTest State',
    pin_code: '500001',
    total_cases_filed: 0,
    total_cases_resolved: 0,
  });
  testIds.courts.push(court._id);

  // ── Case A: Future filing date ──
  const caseA = await Case.create({
    cnr_number: `ERR-A-${Date.now()}`,
    case_type: 'fraud',
    court: court._id,
    victim_user: victim._id,
    filing_date: daysFromNow(10),
    current_status: 'filed',
  });
  testIds.cases.push(caseA._id);

  // ── Case B: Disposed but has future next_hearing_date ──
  const caseB = await Case.create({
    cnr_number: `ERR-B-${Date.now()}`,
    case_type: 'theft',
    court: court._id,
    victim_user: victim._id,
    filing_date: daysAgo(200),
    current_status: 'judgment',
    next_hearing_date: daysFromNow(5),
  });
  testIds.cases.push(caseB._id);

  // ── Case C: Active but next_hearing_date far in the past ──
  const caseC = await Case.create({
    cnr_number: `ERR-C-${Date.now()}`,
    case_type: 'cybercrime',
    court: court._id,
    victim_user: victim._id,
    filing_date: daysAgo(100),
    current_status: 'hearing',
    next_hearing_date: daysAgo(30),
  });
  testIds.cases.push(caseC._id);

  // ── Case D: Has events before filing date + hearing after judgment ──
  const caseD = await Case.create({
    cnr_number: `ERR-D-${Date.now()}`,
    case_type: 'domestic_violence',
    court: court._id,
    victim_user: victim._id,
    filing_date: daysAgo(60),
    current_status: 'judgment',
  });
  testIds.cases.push(caseD._id);

  // Events for Case D
  const evD1 = await CaseEvent.create({
    case: caseD._id,
    event_type: 'hearing',
    event_date: daysAgo(90), // Before filing — impossible!
    event_description: 'Impossible hearing before filing',
    created_by: victim._id,
  });
  testIds.events.push(evD1._id);

  const evD2 = await CaseEvent.create({
    case: caseD._id,
    event_type: 'judgment',
    event_date: daysAgo(20),
    event_description: 'Judgment passed',
    created_by: victim._id,
  });
  testIds.events.push(evD2._id);

  const evD3 = await CaseEvent.create({
    case: caseD._id,
    event_type: 'hearing',
    event_date: daysAgo(5), // After judgment — impossible!
    event_description: 'Hearing after judgment',
    created_by: victim._id,
  });
  testIds.events.push(evD3._id);

  // ── Case E: Status "judgment" but no judgment event ──
  const caseE = await Case.create({
    cnr_number: `ERR-E-${Date.now()}`,
    case_type: 'murder',
    court: court._id,
    victim_user: victim._id,
    filing_date: daysAgo(120),
    current_status: 'judgment',
  });
  testIds.cases.push(caseE._id);
  // No judgment event created — mismatch!

  // ── Case F: Status "filed" but has hearing events ──
  const caseF = await Case.create({
    cnr_number: `ERR-F-${Date.now()}`,
    case_type: 'fraud',
    court: court._id,
    victim_user: victim._id,
    filing_date: daysAgo(80),
    current_status: 'filed',
    total_hearings: 0, // Incorrect — should be 2
    adjournment_count: 5, // Incorrect — should be 0
  });
  testIds.cases.push(caseF._id);

  const evF1 = await CaseEvent.create({
    case: caseF._id,
    event_type: 'hearing',
    event_date: daysAgo(50),
    event_description: 'First hearing',
    created_by: victim._id,
  });
  testIds.events.push(evF1._id);

  const evF2 = await CaseEvent.create({
    case: caseF._id,
    event_type: 'hearing',
    event_date: daysAgo(30),
    event_description: 'Second hearing',
    created_by: victim._id,
  });
  testIds.events.push(evF2._id);

  // ── Case G: Document mismatch case ──
  const caseG = await Case.create({
    cnr_number: `ERR-G-${Date.now()}`,
    case_type: 'dowry',
    court: court._id,
    victim_user: victim._id,
    filing_date: daysAgo(90),
    current_status: 'hearing',
    total_hearings: 4,
  });
  testIds.cases.push(caseG._id);

  // Upload a judgment doc but case is in "hearing" status
  const docG1 = await Document.create({
    case: caseG._id,
    uploaded_by: victim._id,
    doc_type: 'judgment',
    file_name: 'fake_judgment.pdf',
    file_path: 'uploads/test/fake_judgment.pdf',
    file_size: 1024,
    mime_type: 'application/pdf',
    verified_status: 'pending',
    createdAt: daysAgo(10), // Pending for 10 days
  });
  testIds.docs.push(docG1._id);

  // ── Case H: Clean case — should have NO errors ──
  const caseH = await Case.create({
    cnr_number: `ERR-H-${Date.now()}`,
    case_type: 'other',
    court: court._id,
    victim_user: victim._id,
    filing_date: daysAgo(30),
    current_status: 'hearing',
    total_hearings: 1,
    adjournment_count: 0,
    next_hearing_date: daysFromNow(7),
  });
  testIds.cases.push(caseH._id);

  const evH1 = await CaseEvent.create({
    case: caseH._id,
    event_type: 'filing',
    event_date: daysAgo(30),
    event_description: 'Case filed',
    created_by: victim._id,
  });
  testIds.events.push(evH1._id);

  const evH2 = await CaseEvent.create({
    case: caseH._id,
    event_type: 'hearing',
    event_date: daysAgo(10),
    event_description: 'First hearing',
    created_by: victim._id,
  });
  testIds.events.push(evH2._id);

  console.log('   ✅ 1 user, 1 court, 8 cases (A-H), events, docs created');
  return { victim, court, caseA, caseB, caseC, caseD, caseE, caseF, caseG, caseH };
}

// ============================================================
// Test 1: Date Sequence Errors
// ============================================================
async function testDateSequences(data) {
  console.log('\n   --- Test 1: Date Sequence Checks ---\n');

  // Case A: future filing date
  const errorsA = await checkDateSequences(await Case.findById(data.caseA._id));
  check('Case A: detects future filing date', errorsA.some(e => e.code === 'ERR_FILING_DATE_FUTURE'));

  // Case B: judgment + future hearing
  const errorsB = await checkDateSequences(await Case.findById(data.caseB._id));
  check('Case B: detects future hearing on disposed case', errorsB.some(e => e.code === 'ERR_FUTURE_HEARING_DISPOSED'));

  // Case C: active + past next_hearing
  const errorsC = await checkDateSequences(await Case.findById(data.caseC._id));
  check('Case C: detects past next_hearing on active case', errorsC.some(e => e.code === 'ERR_PAST_NEXT_HEARING'));

  // Case H: clean — no date errors
  const errorsH = await checkDateSequences(await Case.findById(data.caseH._id));
  check('Case H (clean): no date sequence errors', errorsH.length === 0);
}

// ============================================================
// Test 2: Impossible Timeline
// ============================================================
async function testImpossibleTimeline(data) {
  console.log('\n   --- Test 2: Impossible Timeline ---\n');

  // Case D: events before filing + hearing after judgment
  const errorsD = await checkImpossibleTimeline(await Case.findById(data.caseD._id));
  check('Case D: detects events before filing date', errorsD.some(e => e.code === 'ERR_EVENTS_BEFORE_FILING'));
  check('Case D: detects hearing after judgment', errorsD.some(e => e.code === 'ERR_HEARING_AFTER_JUDGMENT'));

  // Case H: clean timeline
  const errorsH = await checkImpossibleTimeline(await Case.findById(data.caseH._id));
  check('Case H (clean): no timeline errors', errorsH.length === 0);
}

// ============================================================
// Test 3: Status vs Timeline Mismatch
// ============================================================
async function testStatusMismatch(data) {
  console.log('\n   --- Test 3: Status Mismatch ---\n');

  // Case E: judgment status but no judgment event
  const errorsE = await checkStatusMismatch(await Case.findById(data.caseE._id));
  check('Case E: detects judgment status w/o judgment event', errorsE.some(e => e.code === 'ERR_STATUS_NO_JUDGMENT_EVENT'));

  // Case F: filed status but has hearing events
  const errorsF = await checkStatusMismatch(await Case.findById(data.caseF._id));
  check('Case F: detects filed status with hearings', errorsF.some(e => e.code === 'ERR_STATUS_FILED_HAS_HEARINGS'));

  // Case H: clean
  const errorsH = await checkStatusMismatch(await Case.findById(data.caseH._id));
  check('Case H (clean): no status mismatch', errorsH.length === 0);
}

// ============================================================
// Test 4: Counter Mismatch
// ============================================================
async function testCounterMismatch(data) {
  console.log('\n   --- Test 4: Counter Mismatch ---\n');

  // Case F: total_hearings=0 but 2 hearing events, adjournment_count=5 but 0 adjournment events
  const errorsF = await checkCounterMismatch(await Case.findById(data.caseF._id));
  check('Case F: detects hearing count mismatch', errorsF.some(e => e.code === 'ERR_HEARING_COUNT_MISMATCH'));
  check('Case F: detects adjournment count mismatch', errorsF.some(e => e.code === 'ERR_ADJOURNMENT_COUNT_MISMATCH'));

  // Case H: clean (1 hearing event, total_hearings=1, 0 adjournments)
  const errorsH = await checkCounterMismatch(await Case.findById(data.caseH._id));
  check('Case H (clean): no counter mismatch', errorsH.length === 0);
}

// ============================================================
// Test 5: Document-Input Mismatch
// ============================================================
async function testDocumentMismatch(data) {
  console.log('\n   --- Test 5: Document Mismatch ---\n');

  // Case G: judgment doc but status is "hearing"
  const errorsG = await checkDocumentMismatch(await Case.findById(data.caseG._id));
  check('Case G: detects judgment doc vs hearing status', errorsG.some(e => e.code === 'ERR_DOC_TYPE_STATUS_MISMATCH'));
  check('Case G: detects long-pending unverified doc', errorsG.some(e => e.code === 'ERR_LONG_PENDING_UNVERIFIED'));

  // Case H: no documents — should return no doc errors
  const errorsH = await checkDocumentMismatch(await Case.findById(data.caseH._id));
  check('Case H (clean): no document mismatch', errorsH.length === 0);
}

// ============================================================
// Test 6: Full Case Scan + Alert Generation
// ============================================================
async function testFullCaseScan(data) {
  console.log('\n   --- Test 6: Full Case Scan ---\n');

  // Scan Case F (has multiple issues)
  const result = await scanCaseForErrors(data.caseF._id, { generateAlerts: true });
  check('Case F scan: errors array is populated', result.errors.length > 0);
  check('Case F scan: has cnr_number', !!result.cnr_number);
  check('Case F scan: has caseId', !!result.caseId);
  check('Case F scan: alerts were created', result.alertsCreated > 0);

  // Count alerts created for case F
  const alertCount = await Alert.countDocuments({
    case: data.caseF._id,
    alert_type: 'error_detected',
  });
  check('Case F: error_detected alerts exist in DB', alertCount > 0);

  // Track created alerts for cleanup
  const createdAlerts = await Alert.find({
    case: { $in: testIds.cases },
    alert_type: 'error_detected',
  }).select('_id').lean();
  testIds.alerts = createdAlerts.map(a => a._id);

  // Scan Case H (clean) — should have 0 errors
  const resultH = await scanCaseForErrors(data.caseH._id, { generateAlerts: true });
  check('Case H (clean): full scan finds 0 errors', resultH.errors.length === 0);
  check('Case H (clean): no alerts created', resultH.alertsCreated === 0);
}

// ============================================================
// Test 7: Bulk Scan + Summary
// ============================================================
async function testBulkScanAndSummary() {
  console.log('\n   --- Test 7: Bulk Scan & Summary ---\n');

  // Scan all (will cover our test cases + any existing)
  const bulkResult = await scanAllCasesForErrors({ generateAlerts: false });
  check('Bulk scan: totalCasesScanned > 0', bulkResult.totalCasesScanned > 0);
  check('Bulk scan: has totalErrors', typeof bulkResult.totalErrors === 'number');
  check('Bulk scan: has casesWithErrors', typeof bulkResult.casesWithErrors === 'number');
  check('Bulk scan: results is array', Array.isArray(bulkResult.results));

  // Error summary stats
  const summary = await getErrorSummary();
  check('Summary: has total_error_alerts', typeof summary.total_error_alerts === 'number');
  check('Summary: has unresolved_errors', typeof summary.unresolved_errors === 'number');
  check('Summary: has by_severity', typeof summary.by_severity === 'object');
  check('Summary: total_error_alerts > 0 (from test 6)', summary.total_error_alerts > 0);
}

// ============================================================
// Cleanup
// ============================================================
async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');
  await Alert.deleteMany({ case: { $in: testIds.cases } });
  await Document.deleteMany({ _id: { $in: testIds.docs } });
  await CaseEvent.deleteMany({ _id: { $in: testIds.events } });
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
  console.log('  🧪 Stage 17 Test — Error Detection & Validation');
  console.log('═══════════════════════════════════════════════════');

  try {
    await connectDB();
    await connectRedis();

    const data = await setup();

    await testDateSequences(data);
    await testImpossibleTimeline(data);
    await testStatusMismatch(data);
    await testCounterMismatch(data);
    await testDocumentMismatch(data);
    await testFullCaseScan(data);
    await testBulkScanAndSummary();

    await cleanup();

    console.log('═══════════════════════════════════════════════════');
    console.log(`   📋 Test Results: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════════\n');

    if (failed > 0) {
      console.log('❌ Some tests FAILED. Check output above.');
      process.exit(1);
    } else {
      console.log('✅ All Stage 17 tests PASSED!');
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
