// ============================================================
// Document Routes — Upload, List, Download, Verify, Delete
// ============================================================
// Uses storageService for cloud-ready file management.
// Local disk now, swap to Cloudinary/S3 by changing env.
// ============================================================
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const Document = require('../models/Document');
const Case = require('../models/Case');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');
const { authorize, denyVisitor, readOnlyForVisitor } = require('../middleware/rbac');
const { auditMiddleware, createAuditEntry } = require('../middleware/audit');
const { uploadLimiter } = require('../middleware/rateLimiter');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');
const { getFileReference, resolveFilePath, deleteFile, UPLOAD_BASE } = require('../utils/storageService');
const { emitCaseEvent } = require('../services/eventService');

// Audit writes
router.use(auditMiddleware('document'));

// ── Multer Storage Config ──
if (!fs.existsSync(UPLOAD_BASE)) fs.mkdirSync(UPLOAD_BASE, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const caseDir = path.join(UPLOAD_BASE, req.params.caseId || 'general');
    if (!fs.existsSync(caseDir)) fs.mkdirSync(caseDir, { recursive: true });
    cb(null, caseDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError('File type not allowed. Use PDF, JPEG, PNG, DOCX, or TXT.', 400), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// ============================================================
// POST /api/documents/:caseId/upload — Upload document
// ============================================================
router.post('/:caseId/upload', authenticate, denyVisitor, uploadLimiter, upload.single('document'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError('No file uploaded', 400);

    const caseDoc = await Case.findById(req.params.caseId);
    if (!caseDoc) {
      // Clean up dangling upload
      if (req.file && req.file.path) fs.unlinkSync(req.file.path);
      throw new AppError('Case not found', 404);
    }

    // Ownership check for victims
    if (req.user.role === 'victim' && caseDoc.victim_user?.toString() !== req.user._id.toString()) {
      fs.unlinkSync(req.file.path);
      throw new AppError('You can only upload documents to your own cases.', 403);
    }

    const doc_type = req.body.doc_type || 'other';
    const validTypes = ['fir', 'court_order', 'chargesheet', 'notice', 'judgment', 'evidence', 'id_proof', 'other'];
    if (!validTypes.includes(doc_type)) {
      fs.unlinkSync(req.file.path);
      throw new AppError(`Invalid doc_type. Must be: ${validTypes.join(', ')}`, 400);
    }

    // Get cloud-ready file reference
    const fileRef = getFileReference(req.file, req.params.caseId);

    const document = await Document.create({
      case: caseDoc._id,
      uploaded_by: req.user._id,
      doc_type,
      file_name: req.file.originalname,
      file_path: fileRef.storagePath,        // Relative/cloud path (not absolute)
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      verified_status: 'pending',
    });

    logger.info(`📄 Document uploaded: ${req.file.originalname} → case ${caseDoc.cnr_number} by ${req.user.email} [${fileRef.provider}]`);

    // ── Emit Real-Time Event ──
    try {
      await emitCaseEvent({
        caseId: caseDoc._id,
        type: 'DOCUMENT_UPLOADED',
        message: `Document "${req.file.originalname}" uploaded to case ${caseDoc.cnr_number}`,
        createdBy: req.user._id,
        metadata: {
          caseNumber: caseDoc.cnr_number,
          docType: doc_type,
          fileName: req.file.originalname,
        },
        rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim'],
        usersVisibleTo: caseDoc.victim_user ? [caseDoc.victim_user] : [],
      });
    } catch (eventErr) {
      logger.warn(`Failed to emit document upload event: ${eventErr.message}`);
    }

    // ── Auto-trigger AI processing ──
    let aiJob = null;
    try {
      const { enqueueAIJob } = require('../workers/aiProcessing');
      aiJob = await enqueueAIJob({
        documentId: document._id.toString(),
        caseId: caseDoc._id.toString(),
        filePath: fileRef.storagePath,
        docType: doc_type,
      });
    } catch (aiErr) {
      logger.warn({ aiErr }, '⚠️  AI auto-processing skipped');
    }

    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully',
      data: {
        document: {
          _id: document._id,
          doc_type: document.doc_type,
          file_name: document.file_name,
          file_size: document.file_size,
          mime_type: document.mime_type,
          verified_status: document.verified_status,
          storage_provider: fileRef.provider,
          createdAt: document.createdAt,
        },
        ai_processing: aiJob || { enqueued: false, reason: 'AI not available' },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/documents/:caseId — List documents for a case
// ============================================================
router.get('/:caseId', authenticate, readOnlyForVisitor, async (req, res, next) => {
  try {
    const caseDoc = await Case.findById(req.params.caseId);
    if (!caseDoc) throw new AppError('Case not found', 404);

    // Visitors can only see verified documents
    let filter = { case: caseDoc._id };
    if (req.user.role === 'visitor') {
      filter.verified_status = 'verified';
    }

    // Victims can only see documents from their own cases
    if (req.user.role === 'victim' && caseDoc.victim_user?.toString() !== req.user._id.toString()) {
      throw new AppError('You can only view documents for your own cases.', 403);
    }

    const documents = await Document.find(filter)
      .populate('uploaded_by', 'full_name role')
      .sort({ createdAt: -1 })
      .lean();

    // Build safe response — strip internal paths for non-admin users
    const safe = documents.map(d => {
      const doc = { ...d };
      if (!['admin', 'court_staff'].includes(req.user.role)) {
        delete doc.file_path;
      }
      // Add download URL for all users
      doc.download_url = `/api/documents/download/${doc._id}`;
      return doc;
    });

    res.json({
      success: true,
      data: {
        case_id: caseDoc._id,
        cnr_number: caseDoc.cnr_number,
        total: safe.length,
        documents: safe,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/documents/download/:docId — Download a document
// ============================================================
// Serves the actual file for download.
// Ownership and verification status are checked.
// ============================================================
router.get('/download/:docId', authenticate, async (req, res, next) => {
  try {
    const doc = await Document.findById(req.params.docId).populate('case');
    if (!doc) throw new AppError('Document not found', 404);

    // Visitors can only download verified documents
    if (req.user.role === 'visitor' && doc.verified_status !== 'verified') {
      throw new AppError('This document is not yet verified and cannot be downloaded.', 403);
    }

    // Victims can only download documents from their own cases
    if (req.user.role === 'victim') {
      const caseDoc = await Case.findById(doc.case);
      if (caseDoc && caseDoc.victim_user?.toString() !== req.user._id.toString()) {
        throw new AppError('You can only download documents from your own cases.', 403);
      }
    }

    // Resolve actual file path
    const filePath = resolveFilePath(doc.file_path);

    if (!fs.existsSync(filePath)) {
      throw new AppError('File not found on storage. It may have been deleted.', 404);
    }

    // Set headers for download
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.file_name)}"`);
    res.setHeader('Content-Length', doc.file_size);

    // Stream file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);

    fileStream.on('error', (err) => {
      logger.error({ err }, `Error streaming file: ${doc.file_name}`);
      if (!res.headersSent) {
        next(new AppError('Error reading file', 500));
      }
    });

    logger.info(`⬇️ Document downloaded: ${doc.file_name} by ${req.user.email}`);
  } catch (err) {
    next(err);
  }
});

// ============================================================
// PATCH /api/documents/:docId/verify — Verify document (admin/staff)
// ============================================================
// On verification, optionally upgrades user's verification_status
// from 'otp_verified' to 'document_verified'.
// ============================================================
router.patch('/:docId/verify', authenticate, authorize('admin', 'court_staff'), async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const validStatuses = ['verified', 'rejected', 'flagged'];
    if (!status || !validStatuses.includes(status)) {
      throw new AppError(`Status must be: ${validStatuses.join(', ')}`, 400);
    }

    const doc = await Document.findById(req.params.docId);
    if (!doc) throw new AppError('Document not found', 404);

    const oldStatus = doc.verified_status;
    doc.verified_status = status;
    doc.verification_notes = notes || '';
    await doc.save();

    // ── Upgrade user verification status on document verification ──
    let userUpgraded = false;
    if (status === 'verified' && doc.doc_type === 'id_proof') {
      const uploader = await User.findById(doc.uploaded_by);
      if (uploader && uploader.verification_status === 'otp_verified') {
        uploader.verification_status = 'document_verified';
        await uploader.save();
        userUpgraded = true;
        logger.info(`🔓 User ${uploader.email} upgraded to document_verified`);
      }
    }

    await createAuditEntry({
      userId: req.user._id,
      action: 'document.verify',
      entityType: 'document',
      entityId: doc._id,
      oldValue: { status: oldStatus },
      newValue: { status, notes, userUpgraded },
      ipAddress: req.ip,
    });

    logger.info(`📋 Document ${doc._id} → ${status} by ${req.user.email}`);

    res.json({
      success: true,
      message: `Document ${status}${userUpgraded ? '. User verification upgraded to document_verified.' : ''}`,
      data: {
        document: doc,
        user_verification_upgraded: userUpgraded,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// DELETE /api/documents/:docId — Delete document (admin only)
// ============================================================
router.delete('/:docId', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const doc = await Document.findById(req.params.docId);
    if (!doc) throw new AppError('Document not found', 404);

    // Delete file using storage service
    deleteFile(doc.file_path);

    await Document.findByIdAndDelete(doc._id);

    await createAuditEntry({
      userId: req.user._id,
      action: 'document.delete',
      entityType: 'document',
      entityId: doc._id,
      oldValue: { file_name: doc.file_name, doc_type: doc.doc_type },
      ipAddress: req.ip,
    });

    logger.info(`🗑️ Document deleted: ${doc.file_name} by ${req.user.email}`);

    res.json({
      success: true,
      message: 'Document deleted',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
