/* 
 * 📋 QUICK REFERENCE: Event Emission Cheat Sheet
 * Copy-paste these snippets to add real-time events to any route
 */

// ============================================================================
// 1️⃣ IMPORTS (Add to top of route file)
// ============================================================================

const { emitCaseEvent } = require('../services/eventService');

// ============================================================================
// 2️⃣ STATUS_UPDATE EVENT (When case status/court/judge changes)
// ============================================================================

await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'STATUS_UPDATE',
  message: `Case ${caseDoc.cnr_number} status changed from ${oldStatus} to ${status}`,
  createdBy: req.user._id,
  metadata: { oldStatus, newStatus: status, caseNumber: caseDoc.cnr_number },
  rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim'],
  usersVisibleTo: caseDoc.victim_user ? [caseDoc.victim_user] : [],
});

// ============================================================================
// 3️⃣ HEARING_STARTED EVENT (When hearing begins)
// ============================================================================

await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'HEARING_STARTED',
  message: `Hearing started for case ${caseDoc.cnr_number}`,
  createdBy: req.user._id,
  metadata: { hearingDate: new Date(), judge: req.user.name },
  rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim'],
  usersVisibleTo: [caseDoc.victim_user],
});

// ============================================================================
// 4️⃣ HEARING_SCHEDULED EVENT (When new hearing date is set)
// ============================================================================

await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'HEARING_SCHEDULED',
  message: `Hearing scheduled for ${hearingDate.toDateString()}`,
  createdBy: req.user._id,
  metadata: { hearingDate, court: caseDoc.court, judge: caseDoc.judge },
  rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim'],
  usersVisibleTo: [caseDoc.victim_user],
});

// ============================================================================
// 5️⃣ DELAY_ALERT EVENT (When case exceeds time threshold)
// ============================================================================

await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'DELAY_ALERT',
  message: `⚠️ Case ${caseDoc.cnr_number} pending for ${daysSince} days`,
  createdBy: 'SYSTEM',
  metadata: { daysSince, lastUpdate: caseDoc.updatedAt, threshold: 180 },
  rolesVisibleTo: ['admin', 'court_staff', 'advocate'],
  usersVisibleTo: [],
});

// ============================================================================
// 6️⃣ DOCUMENT_UPLOADED EVENT (When new document added)
// ============================================================================

await emitCaseEvent({
  caseId: caseId,
  type: 'DOCUMENT_UPLOADED',
  message: `Document uploaded: ${filename}`,
  createdBy: req.user._id,
  metadata: { filename, docType: req.body.doc_type, sizeKB: fileSize / 1024 },
  rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim'],
  usersVisibleTo: [caseDoc.victim_user],
});

// ============================================================================
// 7️⃣ ADJOURNMENT EVENT (When case is adjourned)
// ============================================================================

await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'ADJOURNMENT',
  message: `Case adjourned to ${adjournmentDate.toDateString()}`,
  createdBy: req.user._id,
  metadata: { adjournmentDate, reason: adjournmentReason, nextDate },
  rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim'],
  usersVisibleTo: [caseDoc.victim_user],
});

// ============================================================================
// 8️⃣ JUDGMENT EVENT (When judgment is issued)
// ============================================================================

await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'JUDGMENT',
  message: `Judgment issued: ${judgmentText}`,
  createdBy: req.user._id,
  metadata: { judgmentDate: new Date(), outcome: judgmentOutcome },
  rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim'],
  usersVisibleTo: [caseDoc.victim_user],
});

// ============================================================================
// 9️⃣ STAGNATION_FLAG EVENT (Auto-trigger when case stagnates)
// ============================================================================

await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'STAGNATION_FLAG',
  message: `🚩 Case flagged for inactivity (${monthsSince} months)`,
  createdBy: 'SYSTEM',
  metadata: { monthsSince, lastAction: caseDoc.lastActionDate },
  rolesVisibleTo: ['admin', 'court_staff'],
  usersVisibleTo: [],
});

// ============================================================================
// 🔟 VERIFICATION_COMPLETE EVENT (When document verified)
// ============================================================================

await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'VERIFICATION_COMPLETE',
  message: `Document verified by ${req.user.name}`,
  createdBy: req.user._id,
  metadata: { documentId, verificationResult, timestamp: new Date() },
  rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim'],
  usersVisibleTo: [caseDoc.victim_user],
});

// ============================================================================
// 1️⃣1️⃣ ADMIN_NOTE EVENT (Internal note, staff only)
// ============================================================================

await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'ADMIN_NOTE',
  message: `Note: ${noteText}`,
  createdBy: req.user._id,
  metadata: { noteText, addedBy: req.user.name },
  rolesVisibleTo: ['admin', 'court_staff'],  // ⚠️ Staff ONLY
  usersVisibleTo: [],
});

// ============================================================================
// 1️⃣2️⃣ CUSTOM EVENT (Use as template for your own event types)
// ============================================================================

await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'OTHER',  // Or define custom type if extending enum
  message: 'Your custom message here',
  createdBy: req.user._id,
  metadata: { /* your custom data */ },
  rolesVisibleTo: ['admin', 'court_staff'],
  usersVisibleTo: [],
});

// ============================================================================
// 🔐 VISIBILITY RULES QUICK REFERENCE
// ============================================================================

/*
EVENT ROLE VISIBILITY PATTERNS:

All stakeholders (public events):
  rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim', 'visitor']

Staff + victims (case stakeholders):
  rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim']
  usersVisibleTo: [caseDoc.victim_user]  // Specific victim only

Staff only (internal):
  rolesVisibleTo: ['admin', 'court_staff']
  usersVisibleTo: []

Staff + assigned advocate (confidential):
  rolesVisibleTo: ['admin', 'court_staff', 'advocate']
  usersVisibleTo: [assignedAdvocateId]

Specific user only (private):
  rolesVisibleTo: []
  usersVisibleTo: [userId]
*/

// ============================================================================
// ⚡ ASYNC PATTERN (Non-blocking emission)
// ============================================================================

// Fire and forget - don't wait for event emission
emitCaseEvent({
  caseId: caseDoc._id,
  type: 'STATUS_UPDATE',
  message: 'Case updated',
  createdBy: req.user._id,
  rolesVisibleTo: ['admin'],
}).catch(err => console.error('Event emission failed:', err));

res.json({ success: true, caseData });  // Returns immediately

// ============================================================================
// 🛡️ ERROR HANDLING PATTERN
// ============================================================================

try {
  // Save case first
  await caseDoc.save();
  
  // Then emit (non-critical failure)
  await emitCaseEvent({
    caseId: caseDoc._id,
    type: 'STATUS_UPDATE',
    message: 'Case updated',
    createdBy: req.user._id,
    rolesVisibleTo: ['admin'],
  });
  
  res.json({ success: true, caseData });
  
} catch (error) {
  // Case was saved (main operation succeeded)
  // Event emission failed (non-critical)
  console.error('Event emission failed:', error.message);
  res.json({ success: true, caseData, warning: 'Live update failed' });
}

// ============================================================================
// 🧪 TEST: Verify Event Was Emitted
// ============================================================================

// In backend/tests/eventEmission.test.js
const Event = require('../models/Event');

const eventsBefore = await Event.countDocuments({ caseId });
await emitCaseEvent({ /* ... */ });
const eventsAfter = await Event.countDocuments({ caseId });

expect(eventsAfter).toBe(eventsBefore + 1);  // Verify count increased

// ============================================================================
// 📊 FRONTEND: See Real-Time Events
// ============================================================================

// Events automatically appear in LiveMonitoringCard component:
// - Shows in sidebar on all dashboards
// - Updates in real-time via Socket.io
// - No manual integration needed in other components
// - Use useLiveEvents hook if building custom components:

import useLiveEvents from '../hooks/useLiveEvents';

function MyComponent() {
  const { events, connected } = useLiveEvents();
  
  return (
    <div>
      {connected && <span>🔴 LIVE</span>}
      {events.map(e => <div>{e.message}</div>)}
    </div>
  );
}

// ============================================================================
// 🔍 DEBUG: Monitor Events in Real-Time
// ============================================================================

// Terminal 1: Watch MongoDB
mongosh
db.events.watch()  // Shows all inserts/updates

// Terminal 2: Watch Redis
redis-cli subscribe case_updates

// Terminal 3: Watch Backend
npm run dev  // Look for console logs

// Browser DevTools Console:
localStorage.debug = 'socket.io-client:*'
// Reload page to see Socket.io messages

// ============================================================================
// 📈 COMMON PATTERNS
// ============================================================================

// Pattern 1: Value changed (with old → new)
metadata: { 
  field: 'status',
  from: oldValue, 
  to: newValue,
  timestamp: Date.now()
}

// Pattern 2: File operation
metadata: {
  fileName: 'document.pdf',
  fileSize: 1024000,
  mimeType: 'application/pdf',
  uploadedBy: req.user.name
}

// Pattern 3: Date-based (audit)
metadata: {
  changedAt: new Date().toISOString(),
  changedBy: req.user.name,
  changedByRole: req.user.role,
  reason: 'manual update'
}

// ============================================================================
// 💡 TIPS
// ============================================================================

/*
✅ DO:
  - Call emitCaseEvent AFTER operation succeeds
  - Use consistent message format: "[Action] [Subject] [Detail]"
  - Include IDs and names for debugging
  - Test with multiple browser tabs open
  - Use firebase/DB native IDs (not string copies) for visibility filtering

❌ DON'T:
  - Emit before saving (operation could fail)
  - Include passwords or PII in message/metadata
  - Use same message for different event types
  - Forget which users should see what
  - Emit for every single database write (only user actions)
*/

module.exports = {
  description: 'Quick reference for event emission across the application',
  eventTypes: [
    'STATUS_UPDATE', 'HEARING_STARTED', 'HEARING_SCHEDULED', 'DELAY_ALERT',
    'DOCUMENT_UPLOADED', 'ADJOURNMENT', 'JUDGMENT', 'STAGNATION_FLAG',
    'VERIFICATION_COMPLETE', 'ADMIN_NOTE', 'OTHER'
  ]
};
