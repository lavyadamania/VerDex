// ============================================================
// AI Routes — Document Analysis, Status, Manual Triggers
// ============================================================
const express = require('express');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const { authorize, denyVisitor } = require('../middleware/rbac');
const { AppError } = require('../middleware/errorHandler');
const aiService = require('../services/aiService');
const { enqueueAIJob, getQueueStatus, processAIJob } = require('../workers/aiProcessing');
const Document = require('../models/Document');
const Case = require('../models/Case');
const { isCaseOwnerRole } = require('../utils/roles');
const logger = require('../utils/logger');

// ============================================================
// GET /api/ai/status — Check AI service availability
// ============================================================
router.get('/status', authenticate, async (req, res) => {
  const aiStatus = aiService.getAIStatus();
  const queueStatus = await getQueueStatus();

  res.json({
    success: true,
    data: {
      ai: aiStatus,
      queue: queueStatus,
    },
  });
});

// ============================================================
// POST /api/ai/analyze/:documentId — Trigger AI analysis
// ============================================================
// Manually trigger AI analysis for a specific document.
// Normally this happens automatically on upload.
// ============================================================
router.post('/analyze/:documentId', authenticate, denyVisitor, async (req, res, next) => {
  try {
    if (!aiService.isAIAvailable()) {
      throw new AppError('AI is not available. Set GEMINI_API_KEY or GROQ_API_KEY in environment.', 503);
    }

    const document = await Document.findById(req.params.documentId);
    if (!document) {
      throw new AppError('Document not found', 404);
    }

    // Check ownership for victims
    const caseDoc = await Case.findById(document.case);
    if (!caseDoc) {
      throw new AppError('Associated case not found', 404);
    }

    if (isCaseOwnerRole(req.user.role) && caseDoc.victim_user?.toString() !== req.user._id.toString()) {
      throw new AppError('You can only analyze documents from your own cases.', 403);
    }

    // Enqueue the AI job
    const enqueueResult = await enqueueAIJob({
      documentId: document._id.toString(),
      caseId: caseDoc._id.toString(),
      filePath: document.file_path,
      docType: document.doc_type,
    });

    logger.info(`🤖 AI analysis triggered for document ${document._id} by ${req.user.email}`);

    res.json({
      success: true,
      message: 'AI analysis job enqueued',
      data: enqueueResult,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/ai/analyze-sync/:documentId — Run AI analysis NOW
// ============================================================
// Synchronous analysis — waits for result. Use sparingly.
// Admin and court_staff only.
// ============================================================
router.post('/analyze-sync/:documentId', authenticate, authorize('admin', 'court_staff'), async (req, res, next) => {
  try {
    if (!aiService.isAIAvailable()) {
      throw new AppError('AI is not available. Set GEMINI_API_KEY or GROQ_API_KEY in environment.', 503);
    }

    const document = await Document.findById(req.params.documentId);
    if (!document) {
      throw new AppError('Document not found', 404);
    }

    const caseDoc = await Case.findById(document.case);
    if (!caseDoc) {
      throw new AppError('Associated case not found', 404);
    }

    // Process synchronously
    const result = await processAIJob({
      documentId: document._id.toString(),
      caseId: caseDoc._id.toString(),
      filePath: document.file_path,
      docType: document.doc_type,
    });

    logger.info(`🤖 Synchronous AI analysis completed for document ${document._id} by ${req.user.email}`);

    res.json({
      success: true,
      message: 'AI analysis completed',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/ai/extract-text/:documentId — OCR only
// ============================================================
router.post('/extract-text/:documentId', authenticate, denyVisitor, async (req, res, next) => {
  try {
    if (!aiService.isAIAvailable()) {
      throw new AppError('AI is not available.', 503);
    }

    const document = await Document.findById(req.params.documentId);
    if (!document) {
      throw new AppError('Document not found', 404);
    }

    // Ownership check
    const caseDoc = await Case.findById(document.case);
    if (isCaseOwnerRole(req.user.role) && caseDoc?.victim_user?.toString() !== req.user._id.toString()) {
      throw new AppError('Access denied.', 403);
    }

    const { resolveFilePath } = require('../utils/storageService');
    const filePath = resolveFilePath(document.file_path);

    const result = await aiService.extractText(filePath);

    // Save extracted text to document
    if (result.success) {
      await Document.findByIdAndUpdate(document._id, { extracted_text: result.text });
    }

    res.json({
      success: true,
      data: {
        documentId: document._id,
        extraction: {
          success: result.success,
          provider: result.provider,
          chars: result.chars || 0,
          text_preview: result.text ? result.text.substring(0, 500) + '...' : null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/ai/summarize/:documentId — Summarize only
// ============================================================
router.post('/summarize/:documentId', authenticate, denyVisitor, async (req, res, next) => {
  try {
    if (!aiService.isAIAvailable()) {
      throw new AppError('AI is not available.', 503);
    }

    const document = await Document.findById(req.params.documentId);
    if (!document) {
      throw new AppError('Document not found', 404);
    }

    // Need extracted text first
    if (!document.extracted_text) {
      throw new AppError('Document text not yet extracted. Run /extract-text first.', 400);
    }

    const result = await aiService.summarizeDocument(document.extracted_text, document.doc_type);

    // Save summary to document
    if (result.success) {
      await Document.findByIdAndUpdate(document._id, { 
        ai_summary: JSON.stringify(result.summary) 
      });
    }

    res.json({
      success: true,
      data: {
        documentId: document._id,
        summary: result,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// POST /api/ai/classify/:documentId — Classify delay only
// ============================================================
router.post('/classify/:documentId', authenticate, denyVisitor, async (req, res, next) => {
  try {
    if (!aiService.isAIAvailable()) {
      throw new AppError('AI is not available.', 503);
    }

    const document = await Document.findById(req.params.documentId);
    if (!document) {
      throw new AppError('Document not found', 404);
    }

    if (!document.extracted_text) {
      throw new AppError('Document text not yet extracted. Run /extract-text first.', 400);
    }

    const result = await aiService.classifyDelay(document.extracted_text);

    res.json({
      success: true,
      data: {
        documentId: document._id,
        classification: result,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// GET /api/ai/queue — Get AI processing queue status
// ============================================================
router.get('/queue', authenticate, authorize('admin'), async (req, res) => {
  const status = await getQueueStatus();
  res.json({
    success: true,
    data: status,
  });
});

module.exports = router;
