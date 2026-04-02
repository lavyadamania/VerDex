// ============================================================
// Stage 14 Test — Victim-Controlled Disclosure System
// ============================================================
// Tests the full disclosure lifecycle:
//   1. Submit disclosure request with safety check
//   2. Admin approves → case fields updated
//   3. Public view respects disclosure_mode
//   4. Victim revokes → fields removed
//   5. Rejection flow
//   6. Edge cases (invalid fields, duplicate requests, ownership)
//
// Usage: node src/tests/testDisclosure.js
// ============================================================
const mongoose = require('mongoose');
const { connectDB, closeDB } = require('../config/database');
const { connectRedis, disconnectRedis } = require('../config/redis');
const User = require('../models/User');
const Case = require('../models/Case');
const Court = require('../models/Court');
const DisclosureRequest = require('../models/DisclosureRequest');
const {
  DISCLOSABLE_FIELDS,
  performSafetyCheck,
  submitDisclosureRequest,
  reviewDisclosureRequest,
  revokeDisclosure,
  getDisclosureHistory,
} = require('../services/disclosureService');

const testIds = { users: [], courts: [], cases: [], disclosures: [] };
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

// ============================================================
// Setup
// ============================================================
async function setup() {
  console.log('\n🔧 Setting up test data...\n');

  const court = await Court.create({
    court_name: 'Disclosure Test Court',
    court_type: 'district',
    district: 'DTest District',
    state: 'DTest State',
    pin_code: '110002',
  });
  testIds.courts.push(court._id);

  const victim = await User.create({
    full_name: 'Disclosure Test Victim',
    email: `dtest_victim_${Date.now()}@test.com`,
    phone: '8000000001',
    password_hash: '$2a$10$testhashedpassword',
    role: 'victim',
    verification_status: 'otp_verified',
  });
  testIds.users.push(victim._id);

  const admin = await User.create({
    full_name: 'Disclosure Test Admin',
    email: `dtest_admin_${Date.now()}@test.com`,
    phone: '8000000002',
    password_hash: '$2a$10$testhashedpassword',
    role: 'admin',
    verification_status: 'fully_verified',
  });
  testIds.users.push(admin._id);

  const otherUser = await User.create({
    full_name: 'Other User',
    email: `dtest_other_${Date.now()}@test.com`,
    phone: '8000000003',
    password_hash: '$2a$10$testhashedpassword',
    role: 'victim',
    verification_status: 'otp_verified',
  });
  testIds.users.push(otherUser._id);

  const testCase = await Case.create({
    cnr_number: `DTEST-${Date.now()}-001`,
    case_type: 'fraud',
    court: court._id,
    victim_user: victim._id,
    filing_date: new Date(),
    current_status: 'hearing',
    accused_name: 'John Doe',
    judge_name: 'Hon. Justice Smith',
    advocate_name: 'Advocate Sharma',
    disclosure_mode: 'private',
    disclosed_fields: [],
  });
  testIds.cases.push(testCase._id);

  // Sensitive case type for safety check
  const sensitiveCase = await Case.create({
    cnr_number: `DTEST-${Date.now()}-002`,
    case_type: 'sexual_assault',
    court: court._id,
    victim_user: victim._id,
    filing_date: new Date(),
    current_status: 'evidence',
    accused_name: 'Accused Person',
    victim_statement: 'Sensitive statement...',
    disclosure_mode: 'private',
    disclosed_fields: [],
  });
  testIds.cases.push(sensitiveCase._id);

  console.log('   ✅ Court, users, and cases created');
  return { court, victim, admin, otherUser, testCase, sensitiveCase };
}

// ============================================================
// Test Safety Check
// ============================================================
function testSafetyCheck(testData) {
  console.log('\n   --- AI Safety Check ---\n');

  const { testCase, sensitiveCase } = testData;

  // Low risk: just accused_name
  const low = performSafetyCheck(testCase, ['accused_name']);
  check('Low risk for single field', low.riskLevel === 'low');
  check('Low risk passes safety check', low.passed === true);

  // Medium risk: accused + judge together
  const medium = performSafetyCheck(testCase, ['accused_name', 'judge_name']);
  check('Medium risk for accused+judge combo', medium.riskLevel === 'medium');
  check('Medium risk has warnings', medium.warnings.length > 0);

  // High risk: victim_statement
  const high = performSafetyCheck(testCase, ['victim_statement']);
  check('High risk for victim_statement', high.riskLevel === 'high');
  check('High risk fails safety check', high.passed === false);

  // Sensitive case type raises risk
  const sensitive = performSafetyCheck(sensitiveCase, ['accused_name']);
  check('Sensitive case type raises risk', sensitive.riskLevel === 'medium');
  check('Sensitive case has warning about case type', sensitive.warnings.some(w => w.includes('sexual_assault')));
}

// ============================================================
// Test Submit Disclosure Request
// ============================================================
async function testSubmitRequest(testData) {
  console.log('\n   --- Submit Disclosure Request ---\n');

  const { victim, testCase, otherUser } = testData;

  // Successful submission
  const result = await submitDisclosureRequest({
    caseId: testCase._id,
    userId: victim._id,
    requestedFields: ['accused_name', 'judge_name'],
    justification: 'Need transparency for my case.',
  });
  testIds.disclosures.push(result.request._id);

  check('Request created successfully', !!result.request._id);
  check('Request status is pending', result.request.status === 'pending');
  check('Requested fields stored', result.request.requested_fields.length === 2);
  check('Safety check result included', result.safetyCheck !== undefined);
  check('Justification stored', result.request.justification === 'Need transparency for my case.');

  // Duplicate request should fail
  let duplicateError = false;
  try {
    await submitDisclosureRequest({
      caseId: testCase._id,
      userId: victim._id,
      requestedFields: ['accused_name'],
      justification: 'Second request',
    });
  } catch (err) {
    duplicateError = true;
  }
  check('Duplicate pending request blocked', duplicateError === true);

  // Non-owner should fail
  let ownerError = false;
  try {
    await submitDisclosureRequest({
      caseId: testCase._id,
      userId: otherUser._id,
      requestedFields: ['accused_name'],
    });
  } catch (err) {
    ownerError = true;
  }
  check('Non-owner cannot submit request', ownerError === true);

  // Invalid fields should fail
  let fieldError = false;
  try {
    await submitDisclosureRequest({
      caseId: testCase._id,
      userId: victim._id,
      requestedFields: ['social_security_number'],
    });
  } catch (err) {
    fieldError = true;
  }
  check('Invalid field names rejected', fieldError === true);

  return result.request;
}

// ============================================================
// Test Admin Approval
// ============================================================
async function testAdminApproval(testData, request) {
  console.log('\n   --- Admin Approval ---\n');

  const { admin, testCase } = testData;

  // Approve the request
  const result = await reviewDisclosureRequest({
    requestId: request._id,
    adminId: admin._id,
    decision: 'approved',
    notes: 'Looks safe to disclose.',
  });

  check('Request status changed to approved', result.request.status === 'approved');
  check('Reviewed_by set', result.request.reviewed_by.toString() === admin._id.toString());
  check('Reviewed_at set', result.request.reviewed_at instanceof Date);
  check('Case updated flag is true', result.caseUpdated === true);

  // Verify case was updated
  const updatedCase = await Case.findById(testCase._id);
  check('Case disclosure_mode changed to partial', updatedCase.disclosure_mode === 'partial');
  check('Case disclosed_fields includes accused_name', updatedCase.disclosed_fields.includes('accused_name'));
  check('Case disclosed_fields includes judge_name', updatedCase.disclosed_fields.includes('judge_name'));

  // Cannot re-review an already-reviewed request
  let reReviewError = false;
  try {
    await reviewDisclosureRequest({
      requestId: request._id,
      adminId: admin._id,
      decision: 'rejected',
    });
  } catch (err) {
    reReviewError = true;
  }
  check('Cannot re-review approved request', reReviewError === true);

  return updatedCase;
}

// ============================================================
// Test Public View Respects Disclosure
// ============================================================
async function testPublicView(testData) {
  console.log('\n   --- Public View ---\n');

  const { testCase } = testData;

  const caseDoc = await Case.findById(testCase._id);

  // Get anonymized view
  const anonymized = caseDoc.toAnonymized();

  check('Anonymized view has case_type', !!anonymized.case_type);
  check('Anonymized view has masked_id', !!anonymized.masked_id);

  // Disclosed fields should appear since mode is 'partial'
  check('Accused name appears in public view (disclosed)', anonymized.accused_name === 'John Doe');
  check('Judge name appears in public view (disclosed)', anonymized.judge_name === 'Hon. Justice Smith');

  // Non-disclosed fields should NOT appear
  check('Advocate name NOT in public view (not disclosed)', anonymized.advocate_name === undefined);
  check('Victim statement NOT in public view', anonymized.victim_statement === undefined);
}

// ============================================================
// Test Revocation
// ============================================================
async function testRevocation(testData, request) {
  console.log('\n   --- Revocation ---\n');

  const { victim, otherUser, testCase } = testData;

  // Non-owner cannot revoke
  let ownerError = false;
  try {
    await revokeDisclosure({
      requestId: request._id,
      userId: otherUser._id,
    });
  } catch (err) {
    ownerError = true;
  }
  check('Non-owner cannot revoke', ownerError === true);

  // Victim revokes
  const result = await revokeDisclosure({
    requestId: request._id,
    userId: victim._id,
  });

  check('Request status changed to revoked', result.request.status === 'revoked');
  check('Case mode changed back to private', result.caseDisclosureMode === 'private');
  check('No remaining disclosed fields', result.remainingFields.length === 0);

  // Verify case state
  const caseAfterRevoke = await Case.findById(testCase._id);
  check('Case disclosure_mode is private after revoke', caseAfterRevoke.disclosure_mode === 'private');
  check('Case disclosed_fields empty after revoke', caseAfterRevoke.disclosed_fields.length === 0);

  // Verify public view no longer shows disclosed fields
  const anonymized = caseAfterRevoke.toAnonymized();
  check('Accused name removed from public view after revoke', anonymized.accused_name === undefined);
  check('Judge name removed from public view after revoke', anonymized.judge_name === undefined);

  // Cannot revoke again
  let doubleRevokeError = false;
  try {
    await revokeDisclosure({ requestId: request._id, userId: victim._id });
  } catch (err) {
    doubleRevokeError = true;
  }
  check('Cannot revoke a non-approved request', doubleRevokeError === true);
}

// ============================================================
// Test Rejection Flow
// ============================================================
async function testRejectionFlow(testData) {
  console.log('\n   --- Rejection Flow ---\n');

  const { victim, admin, testCase } = testData;

  // Submit another request (previous was revoked so no pending exists)
  const result = await submitDisclosureRequest({
    caseId: testCase._id,
    userId: victim._id,
    requestedFields: ['victim_statement'],
    justification: 'Want full transparency.',
  });
  testIds.disclosures.push(result.request._id);

  check('High-risk request created', !!result.request._id);
  check('Safety check flagged high risk', result.safetyCheck.riskLevel === 'high');

  // Admin rejects
  const rejection = await reviewDisclosureRequest({
    requestId: result.request._id,
    adminId: admin._id,
    decision: 'rejected',
    notes: 'Too risky — victim statement may reveal identity.',
  });

  check('Request rejected', rejection.request.status === 'rejected');
  check('Case NOT updated on rejection', rejection.caseUpdated === false);

  // Verify case unchanged
  const caseDoc = await Case.findById(testCase._id);
  check('Case stays private after rejection', caseDoc.disclosure_mode === 'private');
}

// ============================================================
// Test Disclosure History
// ============================================================
async function testHistory(testData) {
  console.log('\n   --- Disclosure History ---\n');

  const { testCase } = testData;

  const history = await getDisclosureHistory(testCase._id);

  check('History has at least 2 requests', history.length >= 2);
  check('History is sorted newest first', history[0].createdAt >= history[1].createdAt);
}

// ============================================================
// Test Constants
// ============================================================
function testConstants() {
  console.log('\n   --- Disclosable Fields ---\n');

  check('DISCLOSABLE_FIELDS includes accused_name', DISCLOSABLE_FIELDS.includes('accused_name'));
  check('DISCLOSABLE_FIELDS includes judge_name', DISCLOSABLE_FIELDS.includes('judge_name'));
  check('DISCLOSABLE_FIELDS includes timeline', DISCLOSABLE_FIELDS.includes('timeline'));
  check('DISCLOSABLE_FIELDS has at least 4 fields', DISCLOSABLE_FIELDS.length >= 4);
}

// ============================================================
// Cleanup
// ============================================================
async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');
  await DisclosureRequest.deleteMany({ _id: { $in: testIds.disclosures } });
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
  console.log('  🧪 Stage 14 Test — Victim-Controlled Disclosure');
  console.log('═══════════════════════════════════════════════════');

  try {
    await connectDB();
    await connectRedis();

    const testData = await setup();

    testConstants();
    testSafetyCheck(testData);
    const request = await testSubmitRequest(testData);
    await testAdminApproval(testData, request);
    await testPublicView(testData);
    await testRevocation(testData, request);
    await testRejectionFlow(testData);
    await testHistory(testData);

    await cleanup();

    console.log('═══════════════════════════════════════════════════');
    console.log(`   📋 Test Results: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════════\n');

    if (failed > 0) {
      console.log('❌ Some tests FAILED. Check output above.');
      process.exit(1);
    } else {
      console.log('✅ All Stage 14 tests PASSED!');
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
