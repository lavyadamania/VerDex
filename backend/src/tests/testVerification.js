// ============================================================
// Stage 13 Test — 4-Layer Verification System
// ============================================================
// Tests the full verification flow:
//   1. CNR format validation (Layer 1)
//   2. OTP verification status check (Layer 2 — already tested)
//   3. Advocate confirmation (Layer 3)
//   4. ID proof upload + admin verification (Layer 4)
//   5. Verification status progression
//   6. Admin override and user listing
//
// Usage: node src/tests/testVerification.js
// ============================================================
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { connectDB, closeDB } = require('../config/database');
const { connectRedis, disconnectRedis } = require('../config/redis');
const User = require('../models/User');
const Case = require('../models/Case');
const Court = require('../models/Court');
const Document = require('../models/Document');
const {
  validateCNR,
  validateCNRFull,
  submitAdvocateConfirmation,
  getVerificationStatus,
  requestVerificationUpgrade,
  adminSetVerificationStatus,
  VERIFICATION_LEVELS,
} = require('../services/verificationService');

// Track created test data for cleanup
const testIds = { users: [], courts: [], cases: [], documents: [] };

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

  // Create test court
  const court = await Court.create({
    court_name: 'Verification Test Court',
    court_type: 'district',
    district: 'VTest District',
    state: 'VTest State',
    pin_code: '110001',
  });
  testIds.courts.push(court._id);

  // Create users at different verification levels
  const unverifiedUser = await User.create({
    full_name: 'Unverified Test User',
    email: `vtest_unverified_${Date.now()}@test.com`,
    phone: '9000000001',
    password_hash: '$2a$10$testhashedpassword',
    role: 'victim',
    verification_status: 'unverified',
  });
  testIds.users.push(unverifiedUser._id);

  const otpVerifiedUser = await User.create({
    full_name: 'OTP Verified Test User',
    email: `vtest_otp_${Date.now()}@test.com`,
    phone: '9000000002',
    password_hash: '$2a$10$testhashedpassword',
    role: 'victim',
    verification_status: 'otp_verified',
  });
  testIds.users.push(otpVerifiedUser._id);

  const adminUser = await User.create({
    full_name: 'Test Admin',
    email: `vtest_admin_${Date.now()}@test.com`,
    phone: '9000000003',
    password_hash: '$2a$10$testhashedpassword',
    role: 'admin',
    verification_status: 'fully_verified',
  });
  testIds.users.push(adminUser._id);

  // Create test case
  const testCase = await Case.create({
    cnr_number: `VTEST-${Date.now()}-001`,
    case_type: 'fraud',
    court: court._id,
    victim_user: otpVerifiedUser._id,
    filing_date: new Date(),
    current_status: 'filed',
  });
  testIds.cases.push(testCase._id);

  console.log('   ✅ Test court created');
  console.log('   ✅ 3 test users created (unverified, otp_verified, admin)');
  console.log('   ✅ 1 test case created');

  return { court, unverifiedUser, otpVerifiedUser, adminUser, testCase };
}

// ============================================================
// Test Layer 1: CNR Format Validation
// ============================================================
async function testCNRValidation() {
  console.log('\n   --- Layer 1: CNR Format Validation ---\n');

  // Valid formats
  const valid1 = validateCNR('DLND010012342024');   // Standard 16 chars
  check('Standard 16-char CNR is valid', valid1.valid === true);

  const valid2 = validateCNR('DLND-0100123-2024');  // Hyphenated
  check('Hyphenated CNR is valid', valid2.valid === true);

  const valid3 = validateCNR('TEST-1234567-2024');  // Flexible format
  check('Flexible alphanumeric CNR is valid', valid3.valid === true);

  // Invalid formats
  const invalid1 = validateCNR('');
  check('Empty CNR is invalid', invalid1.valid === false);
  check('Empty CNR has error message', invalid1.errors.length > 0);

  const invalid2 = validateCNR('AB');
  check('Too-short CNR is invalid', invalid2.valid === false);

  const invalid3 = validateCNR('X'.repeat(30));
  check('Too-long CNR is invalid', invalid3.valid === false);

  const invalid4 = validateCNR('CNR@#$%^&*');
  check('CNR with special chars is invalid', invalid4.valid === false);

  // Full validation with DB check
  console.log('\n   --- Full CNR Validation (with DB) ---\n');

  const fullValid = await validateCNRFull('NEWCNR-1234567-2025');
  check('New CNR is valid format', fullValid.valid === true);
  check('New CNR does not exist in DB', fullValid.exists === false);

  // Check existing CNR
  const existingCase = await Case.findOne({ _id: testIds.cases[0] });
  const fullExisting = await validateCNRFull(existingCase.cnr_number);
  check('Existing CNR format is valid', fullExisting.valid === true);
  check('Existing CNR found in DB', fullExisting.exists === true);
  check('Existing CNR returns case_id', fullExisting.case_id !== null);
}

// ============================================================
// Test Layer 3: Advocate Confirmation
// ============================================================
async function testAdvocateConfirmation(testData) {
  console.log('\n   --- Layer 3: Advocate Confirmation ---\n');

  const { otpVerifiedUser } = testData;

  // Submit advocate details
  const updated = await submitAdvocateConfirmation(otpVerifiedUser._id, {
    advocate_name: 'Advocate Test Singh',
    bar_council_id: 'BCI/TEST/2024/001',
    advocate_phone: '9876543210',
    advocate_email: 'advocate.test@lawfirm.com',
  });

  check('Advocate name stored', updated.advocate_name === 'Advocate Test Singh');
  check('Bar council ID stored', updated.bar_council_id === 'BCI/TEST/2024/001');
  check('Advocate phone stored', updated.advocate_phone === '9876543210');
  check('Advocate confirmed flag set', updated.advocate_confirmed === true);
  check('Advocate confirmed_at is set', updated.advocate_confirmed_at instanceof Date);

  // Verification didn't auto-change (Layer 3 is optional)
  check('Verification status unchanged after advocate confirm', updated.verification_status === 'otp_verified');
}

// ============================================================
// Test Layer 4: Document Verification + Status Upgrade
// ============================================================
async function testDocumentVerification(testData) {
  console.log('\n   --- Layer 4: Document Verification ---\n');

  const { otpVerifiedUser, testCase, adminUser } = testData;

  // Simulate uploading an ID proof document
  const idDoc = await Document.create({
    case: testCase._id,
    uploaded_by: otpVerifiedUser._id,
    doc_type: 'id_proof',
    file_name: 'test_aadhaar.pdf',
    file_path: 'id_proofs/test_file.pdf',
    file_size: 1024,
    mime_type: 'application/pdf',
    verified_status: 'pending',
  });
  testIds.documents.push(idDoc._id);

  check('ID proof document created', !!idDoc._id);
  check('Document status is pending', idDoc.verified_status === 'pending');

  // Try upgrade before admin verifies document (should fail)
  const prematureUpgrade = await requestVerificationUpgrade(otpVerifiedUser._id);
  check('Upgrade denied without verified doc', prematureUpgrade.upgraded === false);
  check('Upgrade message mentions document', prematureUpgrade.message.toLowerCase().includes('document'));

  // Admin verifies the document
  idDoc.verified_status = 'verified';
  idDoc.verification_notes = 'ID proof matches user info';
  await idDoc.save();

  check('Document verified by admin', idDoc.verified_status === 'verified');

  // Now request upgrade: otp_verified → document_verified
  const upgrade1 = await requestVerificationUpgrade(otpVerifiedUser._id);
  check('Upgrade succeeded: otp_verified → document_verified', upgrade1.upgraded === true);
  check('Previous status was otp_verified', upgrade1.from === 'otp_verified');
  check('New status is document_verified', upgrade1.to === 'document_verified');

  // Request upgrade again: document_verified → fully_verified
  const upgrade2 = await requestVerificationUpgrade(otpVerifiedUser._id);
  check('Upgrade succeeded: document_verified → fully_verified', upgrade2.upgraded === true);
  check('Previous status was document_verified', upgrade2.from === 'document_verified');
  check('New status is fully_verified', upgrade2.to === 'fully_verified');

  // Try upgrade again (already fully verified)
  const upgrade3 = await requestVerificationUpgrade(otpVerifiedUser._id);
  check('No upgrade when already fully_verified', upgrade3.upgraded === false);
  check('Message says already verified', upgrade3.message.toLowerCase().includes('already'));

  // Verify user DB state
  const finalUser = await User.findById(otpVerifiedUser._id);
  check('User is now fully_verified in DB', finalUser.verification_status === 'fully_verified');
}

// ============================================================
// Test Verification Status API
// ============================================================
async function testVerificationStatus(testData) {
  console.log('\n   --- Verification Status ---\n');

  const { unverifiedUser, otpVerifiedUser } = testData;

  // Unverified user status
  const unvStatus = await getVerificationStatus(unverifiedUser._id);
  check('Unverified user level = 0', unvStatus.current_level === 0);
  check('Unverified user has next step', unvStatus.next_step !== null);
  check('Layer 2 OTP pending for unverified', unvStatus.layers.layer_2_otp.status === 'pending');

  // Fully verified user status (otpVerifiedUser was upgraded in previous test)
  const fvStatus = await getVerificationStatus(otpVerifiedUser._id);
  check('Fully verified user level = 3', fvStatus.current_level === 3);
  check('Fully verified flag is true', fvStatus.is_fully_verified === true);
  check('Layer 2 OTP completed', fvStatus.layers.layer_2_otp.status === 'completed');
  check('Layer 3 advocate completed', fvStatus.layers.layer_3_advocate.status === 'completed');
  check('Layer 4 document completed', fvStatus.layers.layer_4_document.status === 'completed');
}

// ============================================================
// Test Admin Functions
// ============================================================
async function testAdminFunctions(testData) {
  console.log('\n   --- Admin Functions ---\n');

  const { unverifiedUser, adminUser } = testData;

  // Admin force-set status
  const overridden = await adminSetVerificationStatus(
    unverifiedUser._id,
    'fully_verified',
    adminUser._id
  );
  check('Admin override succeeded', overridden.verification_status === 'fully_verified');

  // Verify in DB
  const dbUser = await User.findById(unverifiedUser._id);
  check('Override reflected in DB', dbUser.verification_status === 'fully_verified');

  // Reset it back for cleanup
  await adminSetVerificationStatus(
    unverifiedUser._id,
    'unverified',
    adminUser._id
  );

  // Invalid status should throw
  let invalidError = false;
  try {
    await adminSetVerificationStatus(unverifiedUser._id, 'invalid_status', adminUser._id);
  } catch (err) {
    invalidError = true;
  }
  check('Invalid status throws error', invalidError === true);
}

// ============================================================
// Test Verification Levels
// ============================================================
function testVerificationLevels() {
  console.log('\n   --- Verification Level Constants ---\n');

  check('unverified = 0', VERIFICATION_LEVELS.unverified === 0);
  check('otp_verified = 1', VERIFICATION_LEVELS.otp_verified === 1);
  check('document_verified = 2', VERIFICATION_LEVELS.document_verified === 2);
  check('fully_verified = 3', VERIFICATION_LEVELS.fully_verified === 3);
}

// ============================================================
// Cleanup
// ============================================================
async function cleanup() {
  console.log('\n🧹 Cleaning up test data...');

  await Document.deleteMany({ _id: { $in: testIds.documents } });
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
  console.log('  🧪 Stage 13 Test — 4-Layer Verification System');
  console.log('═══════════════════════════════════════════════════');

  try {
    await connectDB();
    await connectRedis();

    const testData = await setup();

    testVerificationLevels();
    await testCNRValidation();
    await testAdvocateConfirmation(testData);
    await testDocumentVerification(testData);
    await testVerificationStatus(testData);
    await testAdminFunctions(testData);

    await cleanup();

    console.log('═══════════════════════════════════════════════════');
    console.log(`   📋 Test Results: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════════\n');

    if (failed > 0) {
      console.log('❌ Some tests FAILED. Check output above.');
      process.exit(1);
    } else {
      console.log('✅ All Stage 13 tests PASSED!');
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
