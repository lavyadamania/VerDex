// ============================================================
// Verification Routes — 4-Layer Verification System
// ============================================================
// Implements progressive identity verification:
//   Layer 1: CNR number format validation
//   Layer 2: OTP verification (handled in auth.routes.js)
//   Layer 3: Advocate confirmation
//   Layer 4: Document verification + upgrade request
//
// Endpoints:
//   POST /api/verification/validate-cnr       — Validate CNR format (public)
//   GET  /api/verification/status             — Get verification status
//   POST /api/verification/advocate            — Submit advocate details (Layer 3)
//   POST /api/verification/request-upgrade     — Request status upgrade
//   POST /api/verification/upload-id/:caseId   — Upload ID proof (Layer 4)
//   PATCH /api/verification/admin/:userId      — Admin override status
//   GET   /api/verification/admin/users        — List users by verification level
// ============================================================
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { z } = require('zod');

const { authenticate } = require('../middleware/auth');
const { authorize, denyVisitor } = require('../middleware/rbac');
const { validate } = require('../middleware/validator');
const { auditMiddleware, createAuditEntry } = require('../middleware/audit');
const { AppError } = require('../middleware/errorHandler');
const User = require('../models/User');
const Document = require('../models/Document');
const logger = require('../utils/logger');
const { getFileReference, UPLOAD_BASE } = require('../utils/storageService');
const {
  validateCNR,
  validateCNRFull,
  submitAdvocateConfirmation,
  getVerificationStatus,
  requestVerificationUpgrade,
  adminSetVerificationStatus,
  VERIFICATION_LEVELS,
} = require('../services/verificationService');

// Audit writes
router.use(auditMiddleware('verification'));

// ── Multer setup for ID proof uploads ──
const idUploadDir = path.join(UPLOAD_BASE, 'id_proofs');
if (!fs.existsSync(idUploadDir)) fs.mkdirSync(idUploadDir, { recursive: true });

const idStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = path.join(idUploadDir, req.user._id.toString());
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    cb(null, `id_proof-${uniqueSuffix}${ext}`);
  },
});

const idFileFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('ID proof must be PDF, JPEG, PNG, or WebP.', 400), false);
  }
};

const uploadId = multer({
  storage: idStorage,
  fileFilter: idFileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB for ID proof
});

// ============================================================
// Validation Schemas
// ============================================================
const cnrSchema = z.object({
  cnr_number: z.string().min(3, 'CNR number is required'),
});

const advocateSchema = z.object({
  advocate_name: z.string().min(2, 'Advocate name must be at least 2 characters'),
  bar_council_id: z.string().optional(),
  advocate_phone: z.string().optional(),
  advocate_email: z.string().email('Invalid email').optional().or(z.literal('')),
});

const adminStatusSchema = z.object({
  verification_status: z.enum(['unverified', 'otp_verified', 'document_verified', 'fully_verified']),
  reason: z.string().optional(),
});

// ============================================================
// POST /api/verification/validate-cnr — CNR Format Validation
// ============================================================
// Layer 1: Validates CNR number format and checks uniqueness.
// Access: Public (no auth for basic validation, auth for full check)
// ============================================================
router.post('/validate-cnr', validate(cnrSchema), async (req, res, next) => {
  try {
    const { cnr_number } = req.body;

    // Full validation with DB check
    const result = await validateCNRFull(cnr_number);

    res.json({
      success: true,
      data: {
        cnr_number: cnr_number.trim().toUpperCase(),
        valid: result.valid,
        format: result.format,
        exists_in_system: result.exists,
        case_id: result.case_id,
        case_status: result.case_status,
        errors: result.errors,
        layer: 'Layer 1 — CNR Format Validation',
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/verification/status — Get Verification Status
// ============================================================
// Returns comprehensive verification status with all 4 layers.
// Access: Authenticated users
// ============================================================
router.get('/status', authenticate, async (req, res, next) => {
  try {
    const status = await getVerificationStatus(req.user._id);

    res.json({
      success: true,
      data: status,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/verification/advocate — Submit Advocate Details
// ============================================================
// Layer 3: Records advocate association for the user.
// Optional layer — doesn't block progression.
// Access: Authenticated, non-visitor
// ============================================================
router.post('/advocate', authenticate, denyVisitor, validate(advocateSchema), async (req, res, next) => {
  try {
    const { advocate_name, bar_council_id, advocate_phone, advocate_email } = req.body;

    const user = await submitAdvocateConfirmation(req.user._id, {
      advocate_name,
      bar_council_id,
      advocate_phone,
      advocate_email,
    });

    await createAuditEntry({
      userId: req.user._id,
      action: 'verification.advocate_confirmation',
      entityType: 'user',
      entityId: req.user._id,
      newValue: { advocate_name, bar_council_id },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: 'Advocate details submitted successfully',
      data: {
        advocate_name: user.advocate_name,
        bar_council_id: user.bar_council_id,
        advocate_phone: user.advocate_phone,
        advocate_email: user.advocate_email,
        advocate_confirmed: user.advocate_confirmed,
        layer: 'Layer 3 — Advocate Confirmation',
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/verification/upload-id/:caseId — Upload ID Proof
// ============================================================
// Layer 4: Upload identity document for verification.
// Creates a Document record with doc_type='id_proof'.
// Admin must verify the document to complete Layer 4.
// Access: Authenticated, non-visitor
// ============================================================
router.post('/upload-id/:caseId', authenticate, denyVisitor, uploadId.single('id_proof'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('No file uploaded. Field name must be "id_proof".', 400);

    const Case = require('../models/Case');
    const caseDoc = await Case.findById(req.params.caseId);
    if (!caseDoc) {
      if (req.file?.path) fs.unlinkSync(req.file.path);
      throw new AppError('Case not found', 404);
    }

    // Ownership check: victims can only upload to their own cases
    if (req.user.role === 'victim' && caseDoc.victim_user?.toString() !== req.user._id.toString()) {
      if (req.file?.path) fs.unlinkSync(req.file.path);
      throw new AppError('You can only upload ID proof to your own cases.', 403);
    }

    // Check if user already has a pending or verified ID proof
    const existingIdProof = await Document.findOne({
      uploaded_by: req.user._id,
      doc_type: 'id_proof',
      verified_status: { $in: ['pending', 'verified'] },
    });

    if (existingIdProof) {
      if (req.file?.path) fs.unlinkSync(req.file.path);
      const msg = existingIdProof.verified_status === 'verified'
        ? 'You already have a verified ID document.'
        : 'You already have a pending ID document. Wait for admin review.';
      throw new AppError(msg, 409);
    }

    // Get file reference
    const fileRef = getFileReference(req.file, `id_proofs/${req.user._id}`);

    // Create document record
    const document = await Document.create({
      case: caseDoc._id,
      uploaded_by: req.user._id,
      doc_type: 'id_proof',
      file_name: req.file.originalname,
      file_path: fileRef.storagePath,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      verified_status: 'pending',
    });

    logger.info(`🪪 ID proof uploaded by ${req.user.email}: ${req.file.originalname}`);

    res.status(201).json({
      success: true,
      message: 'ID proof uploaded successfully. Awaiting admin verification.',
      data: {
        document_id: document._id,
        file_name: document.file_name,
        file_size: document.file_size,
        status: 'pending',
        next_step: 'Admin will review your ID proof. Once verified, request upgrade via POST /api/verification/request-upgrade',
        layer: 'Layer 4 — Document Verification',
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/verification/request-upgrade — Request Status Upgrade
// ============================================================
// Checks if user has met requirements for the next verification
// level and upgrades if eligible.
// Access: Authenticated, non-visitor
// ============================================================
router.post('/request-upgrade', authenticate, denyVisitor, async (req, res, next) => {
  try {
    const result = await requestVerificationUpgrade(req.user._id, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const statusCode = result.upgraded ? 200 : 200;

    res.status(statusCode).json({
      success: true,
      data: {
        upgraded: result.upgraded,
        previous_status: result.from,
        current_status: result.to,
        message: result.message,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/verification/admin/:userId — Admin Override Status
// ============================================================
// Admin can force-set any user's verification status.
// Access: admin only
// ============================================================
router.patch('/admin/:userId', authenticate, authorize('admin'), validate(adminStatusSchema), async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { verification_status, reason } = req.body;

    const user = await adminSetVerificationStatus(
      userId,
      verification_status,
      req.user._id,
      {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }
    );

    res.json({
      success: true,
      message: `Verification status updated to ${verification_status}`,
      data: {
        user_id: user._id,
        email: user.email,
        verification_status: user.verification_status,
        reason: reason || 'Admin override',
      },
    });
  } catch (err) {
    if (err.message?.includes('not found')) {
      return next(new AppError(err.message, 404));
    }
    if (err.message?.includes('Invalid status')) {
      return next(new AppError(err.message, 400));
    }
    next(err);
  }
});

// ============================================================
// GET /api/verification/admin/users — List Users by Verification
// ============================================================
// Admin endpoint to see all users grouped by verification level.
// Query params: status, page, limit
// Access: admin only
// ============================================================
router.get('/admin/users', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const {
      status,
      page = 1,
      limit = 20,
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = Math.min(parseInt(limit), 100);
    const skip = (pageNum - 1) * limitNum;

    // Build query
    const query = {};
    if (status) {
      const validStatuses = Object.keys(VERIFICATION_LEVELS);
      if (!validStatuses.includes(status)) {
        throw new AppError(`Invalid status filter. Must be: ${validStatuses.join(', ')}`, 400);
      }
      query.verification_status = status;
    }

    const [users, total, statusCounts] = await Promise.all([
      User.find(query)
        .select('email full_name role verification_status advocate_confirmed advocate_name createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      User.countDocuments(query),
      // Aggregate counts by status
      User.aggregate([
        { $group: { _id: '$verification_status', count: { $sum: 1 } } },
      ]),
    ]);

    // Convert status counts to map
    const countsByStatus = {};
    for (const s of statusCounts) {
      countsByStatus[s._id] = s.count;
    }

    res.json({
      success: true,
      data: {
        users,
        summary: {
          total_users: total,
          unverified: countsByStatus.unverified || 0,
          otp_verified: countsByStatus.otp_verified || 0,
          document_verified: countsByStatus.document_verified || 0,
          fully_verified: countsByStatus.fully_verified || 0,
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
