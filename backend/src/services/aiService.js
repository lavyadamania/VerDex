// ============================================================
// AI Service — Document Analysis Engine
// ============================================================
// Primary:  Google Gemini (Vision for OCR + Text for analysis)
// Fallback: Groq (Llama 3 for fast text analysis)
// Graceful: Skips AI if no API keys configured
//
// Capabilities:
//   1. Document text extraction (OCR via Gemini Vision)
//   2. Legal document summarization
//   3. Delay reason classification
//   4. Combined analyze (extract + summarize + classify)
// ============================================================
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const env = require('../config/env');

// ── Provider Status ──
let geminiAvailable = false;
let groqAvailable = false;

// ── Lazy-loaded modules ──
let GoogleGenerativeAI = null;

/**
 * Initialize AI providers. Call once on startup.
 */
function initializeAI() {
  // Check Gemini
  if (env.GEMINI_API_KEY) {
    try {
      const genAI = require('@google/generative-ai');
      GoogleGenerativeAI = genAI.GoogleGenerativeAI;
      geminiAvailable = true;
      logger.info('🤖 Gemini AI initialized (primary provider)');
    } catch (err) {
      logger.warn('⚠️  @google/generative-ai package not found — Gemini disabled');
    }
  } else {
    logger.warn('⚠️  GEMINI_API_KEY not set — Gemini AI disabled');
  }

  // Check Groq
  if (env.GROQ_API_KEY) {
    groqAvailable = true;
    logger.info('🤖 Groq AI initialized (fallback provider)');
  } else {
    logger.warn('⚠️  GROQ_API_KEY not set — Groq fallback disabled');
  }

  if (!geminiAvailable && !groqAvailable) {
    logger.warn('═══════════════════════════════════════════════════');
    logger.warn('  ⚠️  NO AI PROVIDERS AVAILABLE');
    logger.warn('  AI features will be skipped gracefully.');
    logger.warn('  Set GEMINI_API_KEY or GROQ_API_KEY in .env');
    logger.warn('═══════════════════════════════════════════════════');
  }

  return { geminiAvailable, groqAvailable };
}

/**
 * Check if any AI provider is available.
 */
function isAIAvailable() {
  return geminiAvailable || groqAvailable;
}

/**
 * Get the current AI status.
 */
function getAIStatus() {
  return {
    available: isAIAvailable(),
    primary: geminiAvailable ? 'gemini' : (groqAvailable ? 'groq' : 'none'),
    fallback: geminiAvailable && groqAvailable ? 'groq' : 'none',
    providers: {
      gemini: geminiAvailable,
      groq: groqAvailable,
    },
  };
}

// ============================================================
// GEMINI CALLS
// ============================================================

/**
 * Call Gemini text model.
 */
async function callGeminiText(prompt) {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text();
}

/**
 * Call Gemini Vision model with an image/PDF file.
 */
async function callGeminiVision(filePath, prompt) {
  const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  // Read file and convert to base64
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  const fileBuffer = fs.readFileSync(absolutePath);
  const base64Data = fileBuffer.toString('base64');

  // Determine MIME type
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const mimeType = mimeMap[ext] || 'application/pdf';

  const imagePart = {
    inlineData: {
      data: base64Data,
      mimeType,
    },
  };

  const result = await model.generateContent([prompt, imagePart]);
  const response = await result.response;
  return response.text();
}

// ============================================================
// GROQ CALLS (REST API — no SDK needed)
// ============================================================

/**
 * Call Groq API directly via fetch.
 */
async function callGroqText(prompt, systemPrompt = '') {
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      temperature: 0.1,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// ============================================================
// CORE AI FUNCTIONS
// ============================================================

/**
 * 1. EXTRACT TEXT from a document (OCR).
 *    Uses Gemini Vision for PDFs/images.
 *    Falls back to basic text reading for .txt files.
 */
async function extractText(filePath) {
  if (!isAIAvailable()) {
    logger.warn('⚠️  AI unavailable — skipping text extraction');
    return { success: false, text: null, provider: 'none', reason: 'No AI provider available' };
  }

  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);

  // Handle .txt files directly (no AI needed)
  const ext = path.extname(absPath).toLowerCase();
  if (ext === '.txt') {
    try {
      const text = fs.readFileSync(absPath, 'utf-8');
      return { success: true, text, provider: 'local', chars: text.length };
    } catch (err) {
      return { success: false, text: null, provider: 'local', reason: err.message };
    }
  }

  // For PDFs and images → use Gemini Vision
  if (geminiAvailable) {
    try {
      const prompt = `You are a precise legal document OCR system. Extract ALL text from this document exactly as written. 
Preserve the original formatting, paragraph breaks, and structure.
Do NOT add any commentary or analysis — only extract the raw text content.
If the document contains Hindi or regional language text, transliterate it into English.`;

      const text = await callGeminiVision(absPath, prompt);
      return { success: true, text, provider: 'gemini', chars: text.length };
    } catch (err) {
      logger.error({ err }, '❌ Gemini Vision OCR failed');
      // Fall through to indicate failure
    }
  }

  return {
    success: false,
    text: null,
    provider: 'none',
    reason: 'OCR requires Gemini Vision — Groq cannot process images/PDFs directly',
  };
}

/**
 * 2. SUMMARIZE a legal document.
 *    Takes extracted text and produces a plain-English summary.
 */
async function summarizeDocument(text, docType = 'court_order') {
  if (!isAIAvailable()) {
    logger.warn('⚠️  AI unavailable — skipping summarization');
    return { success: false, summary: null, provider: 'none', reason: 'No AI provider available' };
  }

  if (!text || text.trim().length < 20) {
    return { success: false, summary: null, provider: 'none', reason: 'Insufficient text to summarize' };
  }

  const systemPrompt = `You are a legal document analyst for the Indian judiciary. Your task is to summarize court documents in simple, plain English that a non-lawyer can understand.`;

  const prompt = `Summarize the following ${docType.replace('_', ' ')} document. Provide:

1. **Case Stage**: What stage is the trial at? (e.g., filing, hearing, evidence, arguments, judgment)
2. **Key Decision**: What was the main outcome or order?
3. **Next Steps**: What happens next? Is there a next hearing date?
4. **Plain Summary**: A 2-3 sentence explanation in simple English that a victim can understand.

Keep the response concise and factual. Do NOT use legal jargon.

--- DOCUMENT TEXT ---
${text.substring(0, 8000)}
--- END ---

Respond in this exact JSON format:
{
  "case_stage": "hearing|evidence|arguments|judgment|other",
  "key_decision": "brief description",
  "next_steps": "what happens next",
  "next_hearing_date": "YYYY-MM-DD or null",
  "plain_summary": "2-3 sentence explanation"
}`;

  // Try Gemini first
  if (geminiAvailable) {
    try {
      const raw = await callGeminiText(prompt);
      const parsed = parseJSONResponse(raw);
      if (parsed) {
        return { success: true, summary: parsed, provider: 'gemini' };
      }
    } catch (err) {
      logger.error({ err }, '❌ Gemini summarization failed — trying Groq...');
    }
  }

  // Fallback to Groq
  if (groqAvailable) {
    try {
      const raw = await callGroqText(prompt, systemPrompt);
      const parsed = parseJSONResponse(raw);
      if (parsed) {
        return { success: true, summary: parsed, provider: 'groq' };
      }
    } catch (err) {
      logger.error({ err }, '❌ Groq summarization also failed');
    }
  }

  return { success: false, summary: null, provider: 'none', reason: 'All AI providers failed' };
}

/**
 * 3. CLASSIFY DELAY REASON from document text.
 *    Determines if a delay occurred and who caused it.
 */
async function classifyDelay(text) {
  if (!isAIAvailable()) {
    logger.warn('⚠️  AI unavailable — skipping delay classification');
    return { success: false, classification: null, provider: 'none', reason: 'No AI provider available' };
  }

  if (!text || text.trim().length < 20) {
    return { success: false, classification: null, provider: 'none', reason: 'Insufficient text to classify' };
  }

  const systemPrompt = `You are a legal delay classifier for the Indian judiciary. You analyze court orders to detect adjournments and delays.`;

  const prompt = `Analyze the following court order/document text and classify any delays.

Determine:
1. Was the hearing adjourned (delayed)?
2. If yes, what was the reason?
3. Who is responsible for the delay?

--- DOCUMENT TEXT ---
${text.substring(0, 6000)}
--- END ---

Respond ONLY with this exact JSON format:
{
  "is_adjournment": true/false,
  "adjournment_reason": "brief reason or null",
  "delay_category": "defense_absent|prosecution_absent|judge_absent|evidence_pending|mutual_consent|administrative|witness_absent|covid_lockdown|transfer|none",
  "blamed_party": "defense|prosecution|court|victim|external|none",
  "severity": "minor|moderate|major|critical",
  "confidence": 0.0-1.0,
  "notes": "any additional context"
}`;

  // Try Gemini first
  if (geminiAvailable) {
    try {
      const raw = await callGeminiText(prompt);
      const parsed = parseJSONResponse(raw);
      if (parsed) {
        return { success: true, classification: parsed, provider: 'gemini' };
      }
    } catch (err) {
      logger.error({ err }, '❌ Gemini classification failed — trying Groq...');
    }
  }

  // Fallback to Groq
  if (groqAvailable) {
    try {
      const raw = await callGroqText(prompt, systemPrompt);
      const parsed = parseJSONResponse(raw);
      if (parsed) {
        return { success: true, classification: parsed, provider: 'groq' };
      }
    } catch (err) {
      logger.error({ err }, '❌ Groq classification also failed');
    }
  }

  return { success: false, classification: null, provider: 'none', reason: 'All AI providers failed' };
}

/**
 * 4. FULL ANALYSIS — Extract + Summarize + Classify in one go.
 *    This is the main function called by the AI worker when a document is uploaded.
 */
async function analyzeDocument(filePath, docType = 'court_order') {
  const startTime = Date.now();
  const result = {
    extraction: null,
    summary: null,
    classification: null,
    elapsed_ms: 0,
    ai_available: isAIAvailable(),
  };

  if (!isAIAvailable()) {
    logger.warn('⚠️  AI unavailable — skipping full document analysis');
    result.elapsed_ms = Date.now() - startTime;
    return result;
  }

  // Step 1: Extract text
  logger.info(`🔍 AI: Extracting text from ${path.basename(filePath)}...`);
  result.extraction = await extractText(filePath);

  if (!result.extraction.success || !result.extraction.text) {
    logger.warn(`⚠️  Text extraction failed for ${path.basename(filePath)} — skipping analysis`);
    result.elapsed_ms = Date.now() - startTime;
    return result;
  }

  const extractedText = result.extraction.text;

  // Step 2 & 3: Summarize + Classify in parallel
  logger.info(`📝 AI: Summarizing + classifying ${path.basename(filePath)}...`);
  const [summaryResult, classificationResult] = await Promise.all([
    summarizeDocument(extractedText, docType),
    classifyDelay(extractedText),
  ]);

  result.summary = summaryResult;
  result.classification = classificationResult;
  result.elapsed_ms = Date.now() - startTime;

  logger.info(`✅ AI analysis complete for ${path.basename(filePath)} in ${result.elapsed_ms}ms`);
  return result;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Parse a JSON response from an AI model (handles markdown code blocks).
 */
function parseJSONResponse(raw) {
  if (!raw) return null;

  // Remove markdown code block wrappers if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    logger.warn(`⚠️  Failed to parse AI JSON response: ${err.message}`);
    logger.debug(`Raw response: ${raw.substring(0, 500)}`);

    // Try to extract JSON from the response
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e) {
        return null;
      }
    }
    return null;
  }
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  initializeAI,
  isAIAvailable,
  getAIStatus,
  extractText,
  summarizeDocument,
  classifyDelay,
  analyzeDocument,
};
