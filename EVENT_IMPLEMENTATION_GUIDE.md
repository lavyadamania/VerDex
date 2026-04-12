# 🎯 How to Add Events to Your Routes

This guide shows how to add real-time events to any existing route or service in your application.

## Pattern: Standard Event Emission

### Step 1: Import the Event Service
```javascript
const { emitCaseEvent } = require('../services/eventService');
```

### Step 2: Call emitCaseEvent() at the Right Time
```javascript
await emitCaseEvent({
  caseId: caseId,                                    // Required
  type: 'EVENT_TYPE',                                // Pick from enum
  message: 'Human readable message',                 // Required
  createdBy: req.user._id,                          // Required
  metadata: { key: 'value' },                       // Optional context
  rolesVisibleTo: ['admin', 'advocate'],            // Required
  usersVisibleTo: specificUserIds,                  // Optional specific users
});
```

---

## Examples by Route Type

### Example 1: Case Status Update (Already Implemented)

**Location:** `backend/src/routes/case.routes.js` - PATCH /:id/status

```javascript
// EXISTING CODE IN PATCH /:id/status
caseDoc.status = status;
caseDoc.next_hearing_date = next_hearing_date;
await caseDoc.save();

// ADD THIS:
const { emitCaseEvent } = require('../services/eventService');

await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'STATUS_UPDATE',
  message: `Case ${caseDoc.cnr_number} status changed from ${oldStatus} to ${status}`,
  createdBy: req.user._id,
  metadata: {
    caseNumber: caseDoc.cnr_number,
    oldStatus: oldStatus,
    newStatus: status,
    nextHearing: next_hearing_date,
  },
  rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim'],
  usersVisibleTo: caseDoc.victim_user ? [caseDoc.victim_user] : [],
});
```

---

### Example 2: Adding a New Verification Route

**New Endpoint:** POST /api/verification/verify

```javascript
const express = require('express');
const router = express.Router();
const { emitCaseEvent } = require('../services/eventService');

router.post('/verify', async (req, res) => {
  const { caseId, documentId, verificationResult } = req.body;
  
  try {
    // Your verification logic here
    const verificationRecord = await VerificationModel.create({
      caseId,
      documentId,
      verificationResult,
      verifiedBy: req.user._id,
    });
    
    // EMIT EVENT
    await emitCaseEvent({
      caseId: caseId,
      type: 'VERIFICATION_COMPLETE',
      message: `Document verified by ${req.user.name} - Result: ${verificationResult}`,
      createdBy: req.user._id,
      metadata: {
        documentId: documentId,
        verificationResult: verificationResult,
        verifiedBy: req.user.name,
      },
      rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim'],
      usersVisibleTo: [caseDoc.victim_user],
    });
    
    // Send response
    res.json({ success: true, verification: verificationRecord });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

---

### Example 3: Adding an Adjournment (Already Implemented)

**Location:** `backend/src/routes/case.routes.js` - POST /:id/events

```javascript
// When adjournment is added to case
await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'ADJOURNMENT',
  message: `Case adjourned to ${adjournmentDate.toDateString()}`,
  createdBy: req.user._id,
  metadata: {
    adjournmentDate: adjournmentDate,
    reason: adjournmentReason,
    nextDate: nextCourts_date,
  },
  rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim'],
  usersVisibleTo: [caseDoc.victim_user],
});
```

---

### Example 4: Adding a Judgment Event

**Location:** `backend/src/routes/case.routes.js` - POST /:id/events

```javascript
// When judgment is issued
await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'JUDGMENT',
  message: `Judgment issued: ${judgmentText}`,
  createdBy: req.user._id,
  metadata: {
    judgmentDate: judgmentDate,
    judgmentText: judgmentText,
    outcomeType: outcomeType, // e.g., 'acquittal', 'conviction', 'dismissal'
  },
  rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim'],
  usersVisibleTo: [caseDoc.victim_user],
});
```

---

### Example 5: Delay Alert Detection Service

**Location:** `backend/src/services/delayDetectionService.js` (NEW)

When your delay detection logic runs, emit an alert event:

```javascript
const { emitCaseEvent } = require('./eventService');

async function checkAndEmitDelayAlerts() {
  // Your delay detection logic
  const delayedCases = await findDelayedCases();
  
  for (const caseDoc of delayedCases) {
    // Only emit if this is a NEW delay detection
    if (!caseDoc.delayAlertSent) {
      await emitCaseEvent({
        caseId: caseDoc._id,
        type: 'DELAY_ALERT',
        message: `⚠️ Case ${caseDoc.cnr_number} delayed for ${daysSinceUpdate} days`,
        createdBy: 'SYSTEM', // or some admin user ID
        metadata: {
          daysSinceUpdate: daysSinceUpdate,
          lastUpdate: caseDoc.lastUpdateDate,
          expectedResolutionDate: caseDoc.expectedResolutionDate,
        },
        rolesVisibleTo: ['admin', 'court_staff', 'advocate'],
        usersVisibleTo: [],
      });
      
      // Mark as alert sent
      caseDoc.delayAlertSent = true;
      await caseDoc.save();
    }
  }
}

module.exports = { checkAndEmitDelayAlerts };
```

**Call from somewhere periodic (e.g., daily job):**
```javascript
// In app.js or scheduler
const { checkAndEmitDelayAlerts } = require('./services/delayDetectionService');

// Run daily
setInterval(() => {
  checkAndEmitDelayAlerts().catch(err => console.error('Delay check error:', err));
}, 24 * 60 * 60 * 1000);
```

---

### Example 6: Admin Notes Route (NEW)

**Location:** `backend/src/routes/admin.routes.js`

```javascript
router.post('/cases/:caseId/notes', async (req, res) => {
  const { caseId } = req.params;
  const { noteText } = req.body;
  
  try {
    const caseDoc = await Case.findById(caseId);
    
    // Add note
    caseDoc.adminNotes = caseDoc.adminNotes || [];
    caseDoc.adminNotes.push({
      text: noteText,
      addedBy: req.user._id,
      date: new Date(),
    });
    await caseDoc.save();
    
    // EMIT ADMIN_NOTE EVENT (visible only to staff)
    const { emitCaseEvent } = require('../services/eventService');
    await emitCaseEvent({
      caseId: caseId,
      type: 'ADMIN_NOTE',
      message: `Admin note added by ${req.user.name}: "${noteText}"`,
      createdBy: req.user._id,
      metadata: {
        noteText: noteText,
        addedBy: req.user.name,
      },
      rolesVisibleTo: ['admin', 'court_staff'],  // Only staff see admin notes
      usersVisibleTo: [],
    });
    
    res.json({ success: true, note: caseDoc.adminNotes.at(-1) });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

### Example 7: Alert/Notification Trigger

**Location:** `backend/src/services/alertService.js`

```javascript
async function createAlert(caseId, alertType, message) {
  const { emitCaseEvent } = require('./eventService');
  
  // Create alert in database
  const alert = await Alert.create({
    caseId,
    type: alertType,
    message,
    createdAt: new Date(),
  });
  
  // EMIT REAL-TIME EVENT
  await emitCaseEvent({
    caseId: caseId,
    type: 'ALERT_CREATED',  // or your own alert type
    message: message,
    createdBy: 'SYSTEM',
    metadata: {
      alertType: alertType,
      alertId: alert._id,
    },
    rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim'],
    usersVisibleTo: [],
  });
  
  return alert;
}

module.exports = { createAlert };
```

---

## Event Type Reference

| Type | Used When | Visibility |
|------|-----------|-----------|
| **STATUS_UPDATE** | Case status/court/judge changes | All stakeholders |
| **HEARING_STARTED** | Hearing begins | All stakeholders |
| **HEARING_SCHEDULED** | New hearing date set | All stakeholders |
| **DELAY_ALERT** | Case exceeds time threshold | Admin, Court Staff, Advocate |
| **DOCUMENT_UPLOADED** | New document added | All stakeholders |
| **ADJOURNMENT** | Case adjourned | All stakeholders |
| **JUDGMENT** | Judgment issued | All stakeholders |
| **STAGNATION_FLAG** | Auto-flag if no movement | Admin, Court Staff |
| **VERIFICATION_COMPLETE** | Document verified | All stakeholders |
| **ADMIN_NOTE** | Internal admin note | Admin, Court Staff only |
| **OTHER** | Custom/miscellaneous | Depends on sender |

---

## Best Practices

### ✅ DO:

1. **Emit immediately after action completes:**
   ```javascript
   await caseDoc.save();             // Save first
   await emitCaseEvent({...});       // Then emit
   ```

2. **Include context in metadata:**
   ```javascript
   metadata: {
     caseNumber: caseDoc.cnr_number,
     oldValue: 'filed',
     newValue: 'hearing',
     changedBy: req.user.name,
   }
   ```

3. **Set appropriate visibility:**
   ```javascript
   // Victim can see their case updates
   usersVisibleTo: [caseDoc.victim_user],
   rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim'],
   ```

4. **Use try-catch to prevent emission failures from breaking operations:**
   ```javascript
   try {
     await emitCaseEvent({...});
   } catch (error) {
     console.error('Event emission failed:', error);
     // Continue anyway - case was still updated
   }
   ```

### ❌ DON'T:

1. ❌ Don't emit before saving:
   ```javascript
   // WRONG
   await emitCaseEvent({...});
   await caseDoc.save();  // If this fails, event was already sent
   ```

2. ❌ Don't include duplicate information:
   ```javascript
   // WRONG - message already says status changed
   message: 'Status changed',
   metadata: { 'status_changed': true }
   ```

3. ❌ Don't forget role isolation:
   ```javascript
   // WRONG - victim sees admin-only events
   rolesVisibleTo: ['admin', 'victim']  // Should be admin-only
   ```

4. ❌ Don't block on event emission:
   ```javascript
   // WRONG - if Redis is slow, user waits
   const event = await emitCaseEvent({...});
   res.json({ success: true });  // Blocks until event emitted
   
   // RIGHT - emit async
   emitCaseEvent({...}).catch(err => console.error(err));
   res.json({ success: true });  // Returns immediately
   ```

---

## Testing Your Event Implementation

### Manual Test:
```bash
# 1. Terminal 1: Backend running
cd backend && npm run dev

# 2. Terminal 2: Monitor Redis
redis-cli subscribe case_updates

# 3. Browser: Open dashboard
http://localhost:5173

# 4. Trigger your event (via API or UI)
# 5. Verify in Redis terminal: Message appears
# 6. Verify in browser: Event shows in LiveMonitoringCard in real-time
```

### Automated Test Example:
```javascript
// backend/tests/eventEmission.test.js
const { emitCaseEvent } = require('../services/eventService');
const Case = require('../models/Case');
const Event = require('../models/Event');

describe('Event Emission', () => {
  it('should emit event on case status change', async () => {
    const caseDoc = await Case.findOne();
    const eventCount = await Event.countDocuments();
    
    await emitCaseEvent({
      caseId: caseDoc._id,
      type: 'STATUS_UPDATE',
      message: 'Test event',
      createdBy: 'test-user',
      rolesVisibleTo: ['admin'],
    });
    
    const newEventCount = await Event.countDocuments();
    expect(newEventCount).toBe(eventCount + 1);
  });
});
```

---

## Common Issues & Solutions

### Issue: Event not appearing in real-time
**Check:**
- [ ] Socket.io connection active (browser DevTools shows connection)
- [ ] Redis connected (`redis-cli ping` returns PONG)
- [ ] Event saved to MongoDB (check MongoDB compass)
- [ ] Role visibility correct (check user's role vs rolesVisibleTo)

### Issue: Event appears twice
**Cause:** emitCaseEvent called twice, or triggered from multiple places
**Fix:** Add condition to prevent double-emit or idempotency key

### Issue: Events not visible to user
**Check:**
- [ ] User role in rolesVisibleTo array
- [ ] If usersVisibleTo specified, user's _id is in that array
- [ ] Event.js model has correct visibility logic

---

## Next Steps

1. ✅ **You've implemented:** Case status, document upload, adjournment events
2. **Add next:** Delay alert events (auto-triggered)
3. **Then add:** Admin notes, verification events
4. **Advanced:** Create hooks for third-party integrations (email, SMS alerts)

Happy emitting! 🚀
