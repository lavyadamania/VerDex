// ============================================================
// AI Processing Worker (BullMQ + setInterval fallback)
// ============================================================
// Processes uploaded documents through the AI pipeline:
//   1. Text extraction (OCR via Gemini Vision)
//   2. Document summarization
//   3. Delay reason classification
//   4. Updates Document + CaseEvent + Case records
//
// Queue: 'ai-processing'
// Triggered: When a document is uploaded (enqueued by routes)
// ============================================================
const Document = require('../models/Document');
const Case = require('../models/Case');
const CaseEvent = require('../models/CaseEvent');
const { getRedis, isMemoryStore } = require('../config/redis');
const { syncCaseToRedis } = require('../utils/caseCache');
const aiService = require('../services/aiService');
const { resolveFilePath } = require('../utils/storageService');
const logger = require('../utils/logger');

// Track worker handles
let bullmqWorker = null;
let bullmqQueue = null;

// In-memory queue for fallback mode
const memoryQueue = [];
let processing = false;

/**
 * Process a single AI job.
 * Called by both BullMQ worker and fallback processor.
 *
 * @param {Object} jobData - { documentId, caseId, filePath, docType }
 * @returns {Object} Processing result
 */
async function processAIJob(jobData) {
  const { documentId, caseId, filePath, docType } = jobData;
  const startTime = Date.now();

  logger.info(`🤖 AI Worker: Processing document ${documentId} for case ${caseId}`);

  try {
    // Fetch document record
    const document = await Document.findById(documentId);
    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }

    // Resolve actual file path
    const actualPath = resolveFilePath(document.file_path);

    // Run full AI analysis
    const analysis = await aiService.analyzeDocument(actualPath, docType || document.doc_type);

    // ── Update Document with AI results ──
    const docUpdate = {};

    if (analysis.extraction?.success) {
      docUpdate.extracted_text = analysis.extraction.text;
    }

    if (analysis.summary?.success) {
      docUpdate.ai_summary = JSON.stringify(analysis.summary.summary);
    }

    if (Object.keys(docUpdate).length > 0) {
      await Document.findByIdAndUpdate(documentId, docUpdate);
      logger.info(`📄 Document ${documentId} updated with AI results`);
    }

    // ── Create CaseEvent if delay/adjournment detected ──
    if (analysis.classification?.success && analysis.classification.classification) {
      const cls = analysis.classification.classification;

      if (cls.is_adjournment) {
        // Create adjournment event
        const event = await CaseEvent.create({
          case: caseId,
          event_type: 'adjournment',
          event_date: new Date(),
          event_description: cls.notes || `AI-detected adjournment: ${cls.adjournment_reason}`,
          adjournment_reason: cls.adjournment_reason || cls.delay_category,
          order_summary: analysis.summary?.success
            ? analysis.summary.summary.plain_summary
            : null,
          is_public: false,
          created_by: document.uploaded_by,
        });

        // Update case adjournment count
        await Case.findByIdAndUpdate(caseId, {
          $inc: { adjournment_count: 1 },
          last_update: new Date(),
        });

        // Sync case to Redis
        const updatedCase = await Case.findById(caseId).lean();
        if (updatedCase) {
          await syncCaseToRedis(updatedCase);
        }

        logger.info(`⚖️ Adjournment event created for case ${caseId}: ${cls.adjournment_reason}`);
      } else if (analysis.summary?.success) {
        // No adjournment, but we have a summary — create a general event
        const summary = analysis.summary.summary;

        // Determine event type from AI summary
        const stageToEventType = {
          'hearing': 'hearing',
          'evidence': 'evidence_submitted',
          'arguments': 'argument',
          'judgment': 'judgment',
        };
        const eventType = stageToEventType[summary.case_stage] || 'order';

        await CaseEvent.create({
          case: caseId,
          event_type: eventType,
          event_date: new Date(),
          event_description: summary.key_decision || 'AI-analyzed court order',
          order_summary: summary.plain_summary,
          is_public: false,
          created_by: document.uploaded_by,
        });

        // Update case status if AI detected a stage change
        const caseDoc = await Case.findById(caseId);
        if (caseDoc && summary.case_stage && summary.case_stage !== 'other') {
          const validStatuses = ['filed', 'hearing', 'evidence', 'arguments', 'reserved', 'judgment', 'disposed', 'appealed'];
          if (validStatuses.includes(summary.case_stage) && caseDoc.current_status !== summary.case_stage) {
            caseDoc.current_status = summary.case_stage;
          }
        }

        // Update next hearing date if AI found one
        if (summary.next_hearing_date) {
          const parsedDate = new Date(summary.next_hearing_date);
          if (!isNaN(parsedDate.getTime()) && parsedDate > new Date()) {
            caseDoc.next_hearing_date = parsedDate;
          }
        }

        caseDoc.last_update = new Date();
        await caseDoc.save();

        // Sync to Redis
        await syncCaseToRedis(caseDoc.toObject());

        logger.info(`📋 Case event created for case ${caseId}: ${eventType}`);
      }
    }

    const elapsed = Date.now() - startTime;
    const result = {
      documentId,
      caseId,
      extraction: analysis.extraction?.success || false,
      summarization: analysis.summary?.success || false,
      classification: analysis.classification?.success || false,
      providers_used: {
        extraction: analysis.extraction?.provider,
        summary: analysis.summary?.provider,
        classification: analysis.classification?.provider,
      },
      is_adjournment: analysis.classification?.classification?.is_adjournment || false,
      elapsed_ms: elapsed,
    };

    logger.info(`✅ AI Worker: Document ${documentId} processed in ${elapsed}ms`);
    return result;

  } catch (err) {
    logger.error({ err }, `❌ AI Worker: Failed to process document ${documentId}`);
    throw err;
  }
}

/**
 * Enqueue a document for AI processing.
 *
 * @param {Object} data - { documentId, caseId, filePath, docType }
 */
async function enqueueAIJob(data) {
  if (!aiService.isAIAvailable()) {
    logger.warn(`⚠️  AI unavailable — skipping AI processing for document ${data.documentId}`);
    return { enqueued: false, reason: 'No AI provider available' };
  }

  if (bullmqQueue) {
    // BullMQ mode
    const job = await bullmqQueue.add('process-document', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 30 },
    });
    logger.info(`📨 AI job enqueued (BullMQ): ${job.id} for document ${data.documentId}`);
    return { enqueued: true, jobId: job.id, mode: 'bullmq' };
  }

  // Fallback: in-memory queue
  memoryQueue.push(data);
  logger.info(`📨 AI job enqueued (memory): document ${data.documentId} (queue size: ${memoryQueue.length})`);
  processMemoryQueue(); // Start processing if not already active
  return { enqueued: true, mode: 'memory', queueSize: memoryQueue.length };
}

/**
 * Process the in-memory queue sequentially.
 */
async function processMemoryQueue() {
  if (processing) return;
  processing = true;

  while (memoryQueue.length > 0) {
    const jobData = memoryQueue.shift();
    try {
      await processAIJob(jobData);
    } catch (err) {
      logger.error({ err }, `❌ Memory queue job failed for document ${jobData.documentId}`);
    }
  }

  processing = false;
}

// ============================================================
// BullMQ-based AI Worker
// ============================================================

async function startBullMQWorker() {
  const { Queue, Worker } = require('bullmq');
  const redis = getRedis();

  const connection = {
    host: redis.options?.host || 'localhost',
    port: redis.options?.port || 6379,
    password: redis.options?.password || undefined,
  };

  if (redis.options?.connectionName || redis.options?.tls) {
    connection.tls = redis.options.tls || {};
  }

  // Create queue
  bullmqQueue = new Queue('ai-processing', { connection });

  // Create worker
  bullmqWorker = new Worker(
    'ai-processing',
    async (job) => {
      logger.info(`🤖 BullMQ AI job ${job.id} — processing document ${job.data.documentId}...`);
      const result = await processAIJob(job.data);
      return result;
    },
    {
      connection,
      concurrency: 2, // Process 2 documents at a time
    }
  );

  bullmqWorker.on('completed', (job, result) => {
    logger.info(`✅ BullMQ AI job ${job.id} completed — doc: ${result.documentId} (${result.elapsed_ms}ms)`);
  });

  bullmqWorker.on('failed', (job, err) => {
    logger.error({ err }, `❌ BullMQ AI job ${job?.id} failed`);
  });

  logger.info('🤖 BullMQ AI processing worker started');
}

// ============================================================
// Start / Stop
// ============================================================

/**
 * Start the AI processing worker.
 */
async function startAIWorker() {
  if (!aiService.isAIAvailable()) {
    logger.info('⚠️  AI not available — AI worker not started (documents will skip AI processing)');
    return;
  }

  if (!isMemoryStore()) {
    try {
      await startBullMQWorker();
      return;
    } catch (err) {
      logger.warn({ err }, '⚠️  BullMQ AI worker setup failed — using in-memory queue');
    }
  }

  // Fallback: memory queue is already set up via enqueueAIJob
  logger.info('🤖 AI processing worker running in memory-queue mode');
}

/**
 * Stop the AI processing worker.
 */
async function stopAIWorker() {
  if (bullmqWorker) {
    await bullmqWorker.close();
    bullmqWorker = null;
    logger.info('🤖 BullMQ AI worker stopped');
  }
  if (bullmqQueue) {
    await bullmqQueue.close();
    bullmqQueue = null;
    logger.info('🤖 BullMQ AI queue closed');
  }
}

/**
 * Get queue status.
 */
async function getQueueStatus() {
  if (bullmqQueue) {
    const [waiting, active, completed, failed] = await Promise.all([
      bullmqQueue.getWaitingCount(),
      bullmqQueue.getActiveCount(),
      bullmqQueue.getCompletedCount(),
      bullmqQueue.getFailedCount(),
    ]);
    return { mode: 'bullmq', waiting, active, completed, failed };
  }
  return { mode: 'memory', queueSize: memoryQueue.length, processing };
}

module.exports = {
  processAIJob,
  enqueueAIJob,
  startAIWorker,
  stopAIWorker,
  getQueueStatus,
};
