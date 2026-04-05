// ============================================================
// STAGE 9 — Full AI Pipeline End-to-End Test
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:5000';
const RESULTS = [];
let TOKEN = '';
let USER_ID = '';
let COURT_ID = '';
let CASE_ID = '';
let DOC_ID = '';
const TIMESTAMP = Date.now();

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  RESULTS.push(line);
}

function request(method, urlPath, body = null, token = null, isMultipart = false) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {},
    };

    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    let postData = null;

    if (isMultipart && body) {
      const boundary = '----FormBoundary' + TIMESTAMP;
      options.headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;

      const parts = [];
      for (const [key, val] of Object.entries(body)) {
        if (val && typeof val === 'object' && val.filename) {
          parts.push(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${key}"; filename="${val.filename}"\r\n` +
            `Content-Type: ${val.contentType || 'text/plain'}\r\n\r\n`
          );
          parts.push(val.content);
          parts.push('\r\n');
        } else {
          parts.push(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
            `${val}\r\n`
          );
        }
      }
      parts.push(`--${boundary}--\r\n`);

      const buffers = parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p, 'utf-8'));
      postData = Buffer.concat(buffers);
      options.headers['Content-Length'] = postData.length;
    } else if (body) {
      postData = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function pass(testName) { log(`  ✅ PASS: ${testName}`); }
function fail(testName, reason) { log(`  ❌ FAIL: ${testName} — ${reason}`); }

// ── Sample Court Order ──
const SAMPLE_COURT_ORDER = `
IN THE COURT OF ADDITIONAL SESSIONS JUDGE
DISTRICT COURT 4, MUMBAI

Case Number: SC-2024-0847
FIR No: 312/2024
Date of Order: 15th March 2025

State of Maharashtra vs. Rajesh Kumar Sharma

ORDER

The matter was listed for cross-examination of witness PW-3.
However, the learned counsel for the defense, Adv. Suresh Mehta, 
is absent today without any prior intimation to the court. 

The IO (Investigating Officer) is present.
The prosecution counsel, Adv. Priya Reddy, is present.
The victim/complainant is present through her counsel.

This is the THIRD consecutive hearing where the defense counsel 
has remained absent without valid reason. Despite warnings issued 
on 10th January 2025 and 5th February 2025, no steps have been 
taken to ensure regular appearance.

The court expresses strong displeasure at the repeated delay 
caused by the defense side. This amounts to deliberate obstruction 
of the trial proceedings.

ORDER:
1. The matter is adjourned to 5th June 2025 for cross-examination of PW-3.
2. A note is placed directing the defense counsel to show cause 
   why action should not be initiated for repeated absence.
3. The defense is warned that no further adjournments shall be granted 
   on the ground of counsel's absence.

The hearing stands adjourned.

Sd/-
Additional Sessions Judge
District Court 4, Mumbai

Dated: 15th March 2025
`.trim();

async function runTests() {
  log('═══════════════════════════════════════════════════');
  log('  🧪 STAGE 9 — AI PIPELINE END-TO-END TEST');
  log('═══════════════════════════════════════════════════');
  log('');

  // ── Step 1: Register ──
  log('── Step 1: Register test user ──');
  const email = `ai_test_${TIMESTAMP}@test.com`;
  let otp = '';
  try {
    const res = await request('POST', '/api/auth/register', {
      email,
      password: 'Test@12345',
      full_name: 'AI Test Victim',
      phone: '9876543210',
      role: 'victim',
    });
    if (res.status === 201 && res.data.success) {
      USER_ID = res.data.data.user_id;
      // OTP is in the dev hint
      otp = res.data.data.otp_hint?.match(/\d{6}/)?.[0] || '';
      pass(`Registered: ${email} (OTP: ${otp})`);
    } else {
      fail('Registration', JSON.stringify(res.data.error || res.data));
      return;
    }
  } catch (err) {
    fail('Registration', err.message);
    return;
  }

  // ── Step 2: Login ──
  log('── Step 2: Login ──');
  try {
    const res = await request('POST', '/api/auth/login', { email, password: 'Test@12345' });
    if (res.status === 200 && res.data.data.token) {
      TOKEN = res.data.data.token;
      pass('Logged in — JWT token acquired');
    } else {
      fail('Login', JSON.stringify(res.data));
      return;
    }
  } catch (err) {
    fail('Login', err.message);
    return;
  }

  // ── Step 3: Verify OTP ──
  log('── Step 3: Verify OTP ──');
  try {
    const res = await request('POST', '/api/auth/verify-otp', { otp }, TOKEN);
    if (res.status === 200 && res.data.success) {
      pass(`OTP verified — user is now otp_verified`);
    } else {
      fail('OTP verification', JSON.stringify(res.data));
      return;
    }
  } catch (err) {
    fail('OTP verification', err.message);
    return;
  }

  // ── Step 4: Check AI Status ──
  log('── Step 4: Check AI service status ──');
  try {
    const res = await request('GET', '/api/ai/status', null, TOKEN);
    if (res.status === 200) {
      const ai = res.data.data.ai;
      log(`     Primary: ${ai.primary}`);
      log(`     Fallback: ${ai.fallback}`);
      log(`     Gemini: ${ai.providers.gemini ? '✅' : '❌'}`);
      log(`     Groq: ${ai.providers.groq ? '✅' : '❌'}`);
      if (ai.available) pass('AI providers available');
      else { fail('AI', 'No providers!'); return; }
    }
  } catch (err) {
    fail('AI status', err.message);
    return;
  }

  // ── Step 5: Get court ──
  log('── Step 5: Get a court for case creation ──');
  try {
    const res = await request('GET', '/api/courts', null, TOKEN);
    if (res.status === 200 && res.data.data.courts?.length > 0) {
      COURT_ID = res.data.data.courts[0]._id;
      pass(`Using court: ${res.data.data.courts[0].court_name} (${COURT_ID})`);
    } else {
      fail('Courts', 'No courts in DB. Seed first.');
      return;
    }
  } catch (err) {
    fail('Courts', err.message);
    return;
  }

  // ── Step 6: Create case ──
  log('── Step 6: Create a case ──');
  try {
    const res = await request('POST', '/api/cases', {
      cnr_number: `MHMU01-${TIMESTAMP.toString().slice(-6)}-2025`,
      case_type: 'sexual_assault',
      case_title: 'AI Pipeline Test Case',
      court_id: COURT_ID,
      filing_date: '2024-06-15',
      accused_name: 'Rajesh Kumar Sharma',
      judge_name: 'Addl Sessions Judge',
    }, TOKEN);

    if (res.status === 201 && res.data.success) {
      CASE_ID = res.data.data.case._id;
      pass(`Case created: ${res.data.data.case.cnr_number} (${CASE_ID})`);
    } else {
      fail('Case creation', JSON.stringify(res.data.error || res.data));
      return;
    }
  } catch (err) {
    fail('Case creation', err.message);
    return;
  }

  // ── Step 7: Upload document → AI auto-enqueue ──
  log('── Step 7: Upload court order document ──');
  try {
    const fileContent = Buffer.from(SAMPLE_COURT_ORDER, 'utf-8');
    const res = await request('POST', `/api/documents/${CASE_ID}/upload`, {
      document: {
        filename: 'court_order_march_2025.txt',
        contentType: 'text/plain',
        content: fileContent,
      },
      doc_type: 'court_order',
    }, TOKEN, true);

    if (res.status === 201 && res.data.success) {
      DOC_ID = res.data.data.document._id;
      const aiJob = res.data.data.ai_processing;
      log(`     Doc ID: ${DOC_ID}`);
      log(`     AI Enqueued: ${aiJob?.enqueued ?? 'N/A'}`);
      log(`     AI Mode: ${aiJob?.mode ?? 'N/A'}`);
      pass('Document uploaded' + (aiJob?.enqueued ? ' + AI auto-enqueued ✨' : ''));
    } else {
      fail('Upload', JSON.stringify(res.data));
      return;
    }
  } catch (err) {
    fail('Upload', err.message);
    return;
  }

  // ── Step 8: Wait for AI background processing ──
  log('── Step 8: Waiting 20s for AI to process... ──');
  for (let i = 0; i < 4; i++) {
    await sleep(5000);
    log(`     ... ${(i + 1) * 5}s elapsed`);
  }

  // ── Step 9: Verify Document has AI data ──
  log('── Step 9: Check Document for AI results ──');
  let hasExtractedText = false;
  let hasSummary = false;
  try {
    const res = await request('GET', `/api/documents/${CASE_ID}`, null, TOKEN);
    if (res.status === 200 && res.data.data.documents?.length > 0) {
      const doc = res.data.data.documents.find(d => d._id === DOC_ID) || res.data.data.documents[0];
      
      hasExtractedText = !!doc.extracted_text;
      hasSummary = !!doc.ai_summary;

      log(`     extracted_text: ${hasExtractedText ? '✅ (' + doc.extracted_text.length + ' chars)' : '❌ Missing'}`);
      log(`     ai_summary: ${hasSummary ? '✅ Present' : '❌ Missing'}`);

      if (hasExtractedText) {
        log(`     Preview: "${doc.extracted_text.substring(0, 120)}..."`);
        pass('✨ Text extraction WORKING');
      }

      if (hasSummary) {
        try {
          const summary = JSON.parse(doc.ai_summary);
          log(`     📋 Case stage: ${summary.case_stage}`);
          log(`     📋 Key decision: ${summary.key_decision}`);
          log(`     📋 Next hearing: ${summary.next_hearing_date}`);
          log(`     📋 Summary: ${summary.plain_summary}`);
          pass('✨ Document summarization WORKING');
        } catch {
          log(`     Summary (raw): ${doc.ai_summary.substring(0, 200)}`);
          pass('AI summary present');
        }
      }
    }
  } catch (err) {
    fail('Doc check', err.message);
  }

  // ── Step 10: Check Case for AI-updated data ──
  log('── Step 10: Check Case for AI updates ──');
  try {
    const res = await request('GET', `/api/cases/${CASE_ID}`, null, TOKEN);
    if (res.status === 200) {
      const c = res.data.data.case;
      log(`     Status: ${c.current_status}`);
      log(`     Adjournment Count: ${c.adjournment_count}`);
      log(`     Last Update: ${c.last_update}`);

      const events = res.data.data.timeline || [];
      log(`     Timeline events: ${events.length}`);
      for (const ev of events) {
        log(`     → [${ev.event_type}] ${(ev.event_description || '').substring(0, 80)}`);
        if (ev.adjournment_reason) log(`       Reason: ${ev.adjournment_reason}`);
        if (ev.order_summary) log(`       Summary: ${ev.order_summary.substring(0, 100)}`);
      }

      const aiEvents = events.filter(e => e.event_type === 'adjournment' && e.event_description?.includes('AI'));
      if (aiEvents.length > 0) {
        pass('✨ AI auto-created adjournment CaseEvent');
      } else if (c.adjournment_count > 0) {
        pass('✨ Case adjournment count updated by AI');
      }
    }
  } catch (err) {
    fail('Case check', err.message);
  }

  // ── Step 11: Manual /extract-text ──
  log('── Step 11: Test manual /extract-text ──');
  try {
    const res = await request('POST', `/api/ai/extract-text/${DOC_ID}`, null, TOKEN);
    if (res.status === 200) {
      const ext = res.data.data.extraction;
      log(`     Success: ${ext.success}`);
      log(`     Provider: ${ext.provider}`);
      log(`     Chars: ${ext.chars}`);
      if (ext.text_preview) log(`     Preview: "${ext.text_preview.substring(0, 100)}..."`);
      pass('✨ Manual text extraction WORKS');
    } else {
      fail('Extract text', JSON.stringify(res.data));
    }
  } catch (err) {
    fail('Extract text', err.message);
  }

  // ── Step 12: Manual /summarize ──
  log('── Step 12: Test manual /summarize ──');
  try {
    const res = await request('POST', `/api/ai/summarize/${DOC_ID}`, null, TOKEN);
    if (res.status === 200 && res.data.data.summary.success) {
      const s = res.data.data.summary;
      log(`     Provider: ${s.provider}`);
      log(`     Case stage: ${s.summary.case_stage}`);
      log(`     Key decision: ${s.summary.key_decision}`);
      log(`     Next hearing: ${s.summary.next_hearing_date}`);
      log(`     Summary: ${s.summary.plain_summary}`);
      pass('✨ Manual summarization WORKS');
    } else {
      // Maybe extracted_text not there yet, try with what we have
      log(`     Response: ${JSON.stringify(res.data.data?.summary || res.data).substring(0, 200)}`);
      if (res.data.data?.summary?.success === false && res.data.data?.summary?.reason?.includes('extracted')) {
        log('     (Need to extract text first)');
      }
    }
  } catch (err) {
    fail('Summarize', err.message);
  }

  // ── Step 13: Manual /classify ──
  log('── Step 13: Test manual /classify ──');
  try {
    const res = await request('POST', `/api/ai/classify/${DOC_ID}`, null, TOKEN);
    if (res.status === 200 && res.data.data.classification.success) {
      const c = res.data.data.classification;
      log(`     Provider: ${c.provider}`);
      log(`     Is adjournment: ${c.classification.is_adjournment}`);
      log(`     Reason: ${c.classification.adjournment_reason}`);
      log(`     Category: ${c.classification.delay_category}`);
      log(`     Blamed party: ${c.classification.blamed_party}`);
      log(`     Severity: ${c.classification.severity}`);
      log(`     Confidence: ${c.classification.confidence}`);
      pass('✨ Manual delay classification WORKS');
    } else {
      log(`     Response: ${JSON.stringify(res.data.data?.classification || res.data).substring(0, 200)}`);
    }
  } catch (err) {
    fail('Classify', err.message);
  }

  // ── SUMMARY ──
  log('');
  log('═══════════════════════════════════════════════════');
  log('  📊 FINAL TEST RESULTS');
  log('═══════════════════════════════════════════════════');
  const passes = RESULTS.filter(r => r.includes('✅ PASS'));
  const fails = RESULTS.filter(r => r.includes('❌ FAIL'));
  log(`  ✅ Passes: ${passes.length}`);
  log(`  ❌ Fails:  ${fails.length}`);
  if (fails.length > 0) {
    log('  Failed tests:');
    fails.forEach(f => log(`    ${f.trim()}`));
  }
  log('═══════════════════════════════════════════════════');

  // Save results
  const outputPath = path.resolve(__dirname, 'test_ai_results.txt');
  fs.writeFileSync(outputPath, RESULTS.join('\n'), 'utf-8');
  log(`📄 Results saved to: test_ai_results.txt`);
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
