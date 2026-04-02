// ============================================================
// 4-Layer Verification Service
// ============================================================
// Implements a progressive verification system:
//   Layer 1: CNR number format validation
//   Layer 2: OTP verification (handled in auth.routes.js)
//   Layer 3: Advocate confirmation (stores advocate details)
//   Layer 4: Document upload + admin verification → fully_verified
//
// Status Progression:
//   unverified → otp_verified → document_verified → fully_verified
// ============================================================
const User = require('../models/User');
const Case = require('../models/Case');
const Document = require('../models/Document');
const { createAuditEntry } = require('../middleware/audit');
const logger = require('../utils/logger');

// ============================================================
// CNR Number Validation (Layer 1)
// ============================================================
// Indian CNR format: 2 letters (state) + 2 letters (district)
//   + 2 chars (court type) + 7 digits (serial) + 4 digits (year)
// Example: DLND010012342024 or formatted as DLND01-001234-2024
//
// We also accept flexible formats for testing:
//   - Exact 16 chars: SSDDCC1234567YYYY
//   - Hyphenated:     SS-DD-CC-1234567-YYYY
//   - Simple:         XXXX-XXXXXXX-XXXX  (any alphanumeric)
// ============================================================

/**
 * CNR regex patterns (multiple accepted formats)
 */
const CNR_PATTERNS = [
  // Standard Indian CNR: 16 alphanumeric characters
  /^[A-Z]{4}[A-Z0-9]{2}\d{7}\d{4}$/,
  // Hyphenated format: XXXX-XXXXXXX-YYYY or XX-XX-XX-XXXXXXX-YYYY
  /^[A-Z]{2,4}[0-9]{0,2}-\d{5,7}-\d{4}$/,
  // Flexible alphanumeric with hyphens (for testing)
  /^[A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9]+$/,
  // Simple 16-char alphanumeric
  /^[A-Za-z0-9]{12,20}$/,
];

/**
 * Validate CNR number format.
 *
 * @param {string} cnrNumber - The CNR number to validate
 * @returns {Object} { valid, format, errors }
 */
function validateCNR(cnrNumber) {
  if (!cnrNumber || typeof cnrNumber !== 'string') {
    return {
      valid: false,
      format: null,
      errors: ['CNR number is required and must be a string'],
    };
  }

  const trimmed = cnrNumber.trim().toUpperCase();
  const errors = [];

  // Check minimum length
  if (trimmed.length < 5) {
    errors.push('CNR number too short (minimum 5 characters)');
    return { valid: false, format: null, errors };
  }

  // Check maximum length
  if (trimmed.length > 25) {
    errors.push('CNR number too long (maximum 25 characters)');
    return { valid: false, format: null, errors };
  }

  // Check against patterns
  for (let i = 0; i < CNR_PATTERNS.length; i++) {
    if (CNR_PATTERNS[i].test(trimmed)) {
      return {
        valid: true,
        format: `pattern_${i + 1}`,
        normalized: trimmed,
        errors: [],
      };
    }
  }

  // Check for invalid characters
  if (!/^[A-Za-z0-9\-_/]+$/.test(trimmed)) {
    errors.push('CNR number contains invalid characters. Only letters, numbers, and hyphens are allowed.');
  } else {
    errors.push('CNR number format not recognized. Expected formats: SSDDCCNNNNNNNYYYYY, XXXX-NNNNNNN-YYYY, or similar.');
  }

  return { valid: false, format: null, errors };
}

/**
 * Full CNR validation including database uniqueness check.
 *
 * @param {string} cnrNumber
 * @returns {Object} { valid, format, exists, case_id, errors }
 */
async function validateCNRFull(cnrNumber) {
  const formatResult = validateCNR(cnrNumber);

  if (!formatResult.valid) {
    return { ...formatResult, exists: false, case_id: null };
  }

  // Check if CNR already exists in the system
  const existingCase = await Case.findOne({
    cnr_number: { $regex: new RegExp(`^${formatResult.normalized}$`, 'i') },
  }).select('_id cnr_number current_status').lean();

  return {
    ...formatResult,
    exists: !!existingCase,
    case_id: existingCase?._id || null,
    case_status: existingCase?.current_status || null,
  };
}

// ============================================================
// Advocate Confirmation (Layer 3)
// ============================================================

/**
 * Store advocate details for a user (Layer 3 verification).
 * This doesn't auto-upgrade verification status — it's an
 * optional layer that records advocate association.
 *
 * @param {string} userId
 * @param {Object} advocateDetails
 * @param {string} advocateDetails.advocate_name
 * @param {string} advocateDetails.bar_council_id
 * @param {string} advocateDetails.advocate_phone
 * @param {string} advocateDetails.advocate_email
 * @returns {Object} Updated user
 */
async function submitAdvocateConfirmation(userId, advocateDetails) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  if (user.role === 'visitor') {
    throw new Error('Visitors cannot submit advocate details');
  }

  // Store advocate details on the user
  user.advocate_name = advocateDetails.advocate_name;
  user.bar_council_id = advocateDetails.bar_council_id || null;
  user.advocate_phone = advocateDetails.advocate_phone || null;
  user.advocate_email = advocateDetails.advocate_email || null;
  user.advocate_confirmed = true;
  user.advocate_confirmed_at = new Date();
  await user.save();

  logger.info(`⚖️ Advocate confirmation submitted for user ${user.email}: ${advocateDetails.advocate_name}`);

  return user;
}

// ============================================================
// Verification Status Management
// ============================================================

const VERIFICATION_LEVELS = {
  unverified: 0,
  otp_verified: 1,
  document_verified: 2,
  fully_verified: 3,
};

/**
 * Get comprehensive verification status for a user.
 *
 * @param {string} userId
 * @returns {Object} Full verification breakdown
 */
async function getVerificationStatus(userId) {
  const user = await User.findById(userId).lean();
  if (!user) throw new Error('User not found');

  // Check if user has uploaded ID documents
  const idDocuments = await Document.find({
    uploaded_by: userId,
    doc_type: 'id_proof',
  }).select('verified_status file_name createdAt').lean();

  const hasVerifiedDoc = idDocuments.some(d => d.verified_status === 'verified');
  const hasPendingDoc = idDocuments.some(d => d.verified_status === 'pending');

  // Build layer status
  const layers = {
    layer_1_cnr: {
      name: 'CNR Format Validation',
      status: 'available',       // Always available (client-side)
      description: 'Validate CNR number format before case filing',
    },
    layer_2_otp: {
      name: 'OTP Verification',
      status: VERIFICATION_LEVELS[user.verification_status] >= 1 ? 'completed' : 'pending',
      completed_at: VERIFICATION_LEVELS[user.verification_status] >= 1 ? user.updatedAt : null,
    },
    layer_3_advocate: {
      name: 'Advocate Confirmation',
      status: user.advocate_confirmed ? 'completed' : 'pending',
      optional: true,
      advocate_name: user.advocate_name || null,
      bar_council_id: user.bar_council_id || null,
      completed_at: user.advocate_confirmed_at || null,
    },
    layer_4_document: {
      name: 'Document Verification',
      status: hasVerifiedDoc ? 'completed' : hasPendingDoc ? 'pending_review' : 'not_started',
      documents: idDocuments.map(d => ({
        file_name: d.file_name,
        status: d.verified_status,
        uploaded_at: d.createdAt,
      })),
    },
  };

  // Determine next required step
  let nextStep = null;
  if (VERIFICATION_LEVELS[user.verification_status] < 1) {
    nextStep = 'Complete OTP verification via POST /api/auth/verify-otp';
  } else if (!hasVerifiedDoc && !hasPendingDoc) {
    nextStep = 'Upload ID proof document via POST /api/documents/:caseId/upload with doc_type=id_proof';
  } else if (hasPendingDoc && !hasVerifiedDoc) {
    nextStep = 'Wait for admin to verify your uploaded ID document';
  } else if (hasVerifiedDoc && user.verification_status !== 'fully_verified') {
    nextStep = 'Request full verification upgrade via POST /api/verification/request-upgrade';
  }

  return {
    user_id: user._id,
    email: user.email,
    current_status: user.verification_status,
    current_level: VERIFICATION_LEVELS[user.verification_status],
    max_level: 3,
    layers,
    next_step: nextStep,
    is_fully_verified: user.verification_status === 'fully_verified',
  };
}

/**
 * Request verification upgrade.
 * Checks if user has met requirements for the next level.
 *
 * @param {string} userId
 * @param {Object} auditInfo - { ipAddress, userAgent }
 * @returns {Object} { upgraded, from, to, message }
 */
async function requestVerificationUpgrade(userId, auditInfo = {}) {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const currentLevel = VERIFICATION_LEVELS[user.verification_status];

  // Can't upgrade if already fully verified
  if (currentLevel >= 3) {
    return {
      upgraded: false,
      from: user.verification_status,
      to: user.verification_status,
      message: 'Already fully verified',
    };
  }

  // Check upgrade eligibility
  if (currentLevel === 0) {
    return {
      upgraded: false,
      from: 'unverified',
      to: 'unverified',
      message: 'Please complete OTP verification first (POST /api/auth/verify-otp)',
    };
  }

  if (currentLevel === 1) {
    // Needs verified ID document to upgrade to document_verified
    const verifiedDoc = await Document.findOne({
      uploaded_by: userId,
      doc_type: 'id_proof',
      verified_status: 'verified',
    });

    if (!verifiedDoc) {
      return {
        upgraded: false,
        from: 'otp_verified',
        to: 'otp_verified',
        message: 'Upload and have an ID document verified to progress to document_verified',
      };
    }

    // Upgrade to document_verified
    user.verification_status = 'document_verified';
    await user.save();

    await createAuditEntry({
      userId: user._id,
      action: 'verification.upgrade',
      entityType: 'user',
      entityId: user._id,
      oldValue: { verification_status: 'otp_verified' },
      newValue: { verification_status: 'document_verified' },
      ipAddress: auditInfo.ipAddress,
      userAgent: auditInfo.userAgent,
    });

    logger.info(`🔓 User ${user.email} upgraded: otp_verified → document_verified`);

    return {
      upgraded: true,
      from: 'otp_verified',
      to: 'document_verified',
      message: 'Verification upgraded to document_verified',
    };
  }

  if (currentLevel === 2) {
    // For fully_verified: need document_verified + advocate confirmation (optional)
    // Auto-upgrade to fully_verified if doc-verified
    user.verification_status = 'fully_verified';
    await user.save();

    await createAuditEntry({
      userId: user._id,
      action: 'verification.upgrade',
      entityType: 'user',
      entityId: user._id,
      oldValue: { verification_status: 'document_verified' },
      newValue: { verification_status: 'fully_verified' },
      ipAddress: auditInfo.ipAddress,
      userAgent: auditInfo.userAgent,
    });

    logger.info(`🔓 User ${user.email} upgraded: document_verified → fully_verified`);

    return {
      upgraded: true,
      from: 'document_verified',
      to: 'fully_verified',
      message: 'Verification upgraded to fully_verified',
    };
  }

  return {
    upgraded: false,
    from: user.verification_status,
    to: user.verification_status,
    message: 'Unable to determine upgrade path',
  };
}

/**
 * Admin: Force-set verification status for a user.
 *
 * @param {string} targetUserId
 * @param {string} newStatus
 * @param {string} adminUserId
 * @param {Object} auditInfo
 * @returns {Object} Updated user
 */
async function adminSetVerificationStatus(targetUserId, newStatus, adminUserId, auditInfo = {}) {
  const validStatuses = Object.keys(VERIFICATION_LEVELS);
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid status. Must be: ${validStatuses.join(', ')}`);
  }

  const user = await User.findById(targetUserId);
  if (!user) throw new Error('User not found');

  const oldStatus = user.verification_status;
  user.verification_status = newStatus;
  await user.save();

  await createAuditEntry({
    userId: adminUserId,
    action: 'verification.admin_override',
    entityType: 'user',
    entityId: user._id,
    oldValue: { verification_status: oldStatus },
    newValue: { verification_status: newStatus },
    ipAddress: auditInfo.ipAddress,
    userAgent: auditInfo.userAgent,
  });

  logger.info(`🔧 Admin override: ${user.email} → ${newStatus} (by admin ${adminUserId})`);

  return user;
}

module.exports = {
  validateCNR,
  validateCNRFull,
  submitAdvocateConfirmation,
  getVerificationStatus,
  requestVerificationUpgrade,
  adminSetVerificationStatus,
  VERIFICATION_LEVELS,
};
