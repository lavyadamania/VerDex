# ✅ Real-Time Event System: Implementation Checklist

Use this checklist when:
- ✏️ Adding events to a new route/service
- 🔌 Integrating events into existing code
- 🧪 Testing event implementations
- 🐛 Debugging event issues

---

## 📋 PRE-IMPLEMENTATION CHECKLIST

- [ ] Backend infrastructure files exist and are current:
  - [ ] `backend/src/models/Event.js` - Event schema
  - [ ] `backend/src/services/eventService.js` - emitCaseEvent() function
  - [ ] `backend/src/services/redisSubscriber.js` - Redis→Socket.io bridge
  - [ ] `backend/src/sockets/socketServer.js` - Socket.io server
  - [ ] `backend/src/routes/events.routes.js` - Event API endpoints
  - [ ] `backend/src/app.js` - Socket.io initialization in startup

- [ ] Frontend infrastructure files exist:
  - [ ] `frontend/src/hooks/useLiveEvents.js` - React hook
  - [ ] `frontend/src/services/eventService.js` - API client
  - [ ] `frontend/src/components/live/LiveMonitoringCard.jsx` - UI component
  - [ ] `frontend/src/layouts/Sidebar.jsx` - LiveMonitoringCard integrated

- [ ] Dependencies installed:
  - [ ] Backend: `npm list socket.io` (installed ≥4.7.2)
  - [ ] Frontend: `npm list socket.io-client` (installed ≥4.7.2)

- [ ] Environment variables configured:
  - [ ] `.env` has `MONGO_URI` pointing to working MongoDB
  - [ ] `.env` has `REDIS_URL` pointing to working Redis
  - [ ] `.env` has `JWT_SECRET` set

- [ ] Servers can start without errors:
  - [ ] `cd backend && npm run dev` → No startup errors
  - [ ] `cd frontend && npm run dev` → Build succeeds

---

## 🔧 ADDING NEW EVENT IMPLEMENTATION

### Step 1: Identify Where Event Occurs

- [ ] Event happens in a **route handler** (e.g., `routes/case.routes.js`)
  - [ ] Or event happens in a **service** (e.g., `services/delayDetectionService.js`)
  - [ ] Or event happens in a **scheduled job** (e.g., runs daily)

### Step 2: Choose Event Type from Enum

- [ ] Select type from existing enum:
  - [ ] `STATUS_UPDATE` - Case status/court/judge changes
  - [ ] `HEARING_STARTED` - Hearing begins
  - [ ] `HEARING_SCHEDULED` - New hearing date set
  - [ ] `DELAY_ALERT` - Case exceeds time threshold
  - [ ] `DOCUMENT_UPLOADED` - New document added
  - [ ] `ADJOURNMENT` - Case adjourned
  - [ ] `JUDGMENT` - Judgment issued
  - [ ] `STAGNATION_FLAG` - Case flagged for inactivity
  - [ ] `VERIFICATION_COMPLETE` - Document verified
  - [ ] `ADMIN_NOTE` - Internal admin note
  - [ ] `OTHER` - Miscellaneous

### Step 3: Add Import Statement

In your route/service file, add:
```javascript
const { emitCaseEvent } = require('../services/eventService');
```

- [ ] Import added to file header
- [ ] No duplicate imports

### Step 4: Add Event Emission Call

```javascript
await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'YOUR_EVENT_TYPE',
  message: 'Human readable description',
  createdBy: req.user._id,  // Or 'SYSTEM' for automated events
  metadata: { /* relevant context */ },
  rolesVisibleTo: ['admin', 'court_staff'],  // Who can see this
  usersVisibleTo: [],  // Specific user restrictions
});
```

- [ ] Event emission placed AFTER operation succeeds (after save())
- [ ] caseId is set to correct case Object ID
- [ ] type is valid enum value
- [ ] message is clear and human-readable
- [ ] metadata includes useful context (old values, filenames, etc.)
- [ ] rolesVisibleTo includes appropriate roles
- [ ] usersVisibleTo is empty [] or contains specific user IDs

### Step 5: Handle Errors Gracefully

```javascript
try {
  await operation();  // e.g., caseDoc.save()
  
  await emitCaseEvent({...});  // Emit event
  
  res.json({ success: true, data });
} catch (error) {
  // Operation failed - don't emit
  res.status(500).json({ error: error.message });
}
```

- [ ] Event only emitted if operation succeeds
- [ ] Event emission failure doesn't break main operation
- [ ] Errors logged but don't crash server

### Step 6: Verify Event Type Usage

For each custom event emitted:
- [ ] Event type name is clear and self-documenting
- [ ] Event message template is humanreadable ([action] [subject])
- [ ] Metadata schema is consistent with other events of same type

---

## 🧪 TESTING IMPLEMENTATION

### Test 1: Verify Event Saved to MongoDB

- [ ] Start backend: `npm run dev`
- [ ] Trigger event via UI or API call
- [ ] Check MongoDB:
  ```bash
  mongosh
  db.events.findOne({ type: 'YOUR_EVENT_TYPE' })
  ```
- [ ] Event document exists with all expected fields
- [ ] `caseId` matches correct case
- [ ] `createdBy` matches expected user

### Test 2: Verify Event Published to Redis

- [ ] Start Redis: `redis-cli subscribe case_updates`
- [ ] Trigger event
- [ ] Verify Redis output shows event JSON

### Test 3: Verify Socket.io Receive

- [ ] Open browser DevTools
- [ ] Go to Network tab
- [ ] Filter for "WebSocket"
- [ ] Trigger event
- [ ] Verify WebSocket frame shows event payload

### Test 4: Verify UI Update

- [ ] Open dashboard with LiveMonitoringCard
- [ ] Trigger event
- [ ] Verify new event appears in card within 500ms
- [ ] Verify event has correct:
  - [ ] Icon for event type
  - [ ] Color badge
  - [ ] Message text
  - [ ] Timestamp (shows "now")

### Test 5: Role-Based Visibility

- [ ] Emit event with specific `rolesVisibleTo`
- [ ] Login as different roles
- [ ] Verify visibility rules work:
  - [ ] Users with allowed role see event
  - [ ] Users with disallowed role don't see event

### Test 6: User-Specific Visibility

- [ ] Emit event with specific `usersVisibleTo: [userId]`
- [ ] Login as that user
- [ ] Verify user sees event
- [ ] Login as different user
- [ ] Verify other user doesn't see event

### Test 7: Multi-Tab Sync

- [ ] Open 2 browser tabs to same dashboard
- [ ] Both connected and showing LiveMonitoringCard
- [ ] Trigger event in one tab
- [ ] Verify event appears in BOTH tabs without refresh

### Test 8: Connection Recovery

- [ ] Dashboard connected and showing LIVE
- [ ] Disconnect network (DevTools Network tab → Offline)
- [ ] Verify "Offline" badge appears
- [ ] Go back online
- [ ] Verify "LIVE" badge returns
- [ ] Verify missed events loaded

---

## 🔍 DEBUGGING CHECKLIST

If events aren't appearing in real-time:

### Backend Debugging

- [ ] Check if event has `caseId`:
  ```javascript
  console.log('Event caseId:', caseId, typeof caseId);
  ```

- [ ] Check if MongoDB save works:
  ```javascript
  const event = await Event.create({...});
  console.log('Saved event:', event._id);
  ```

- [ ] Check if Redis publish works:
  ```bash
  redis-cli SUBSCRIBE case_updates
  # Should see message when event triggered
  ```

- [ ] Check if Redis subscriber is listening:
  ```bash
  # In backend logs, look for:
  # [socket.io] Redis subscriber initialized
  # [socket.io] Listening on case_updates
  ```

- [ ] Verify Socket.io rooms are correct:
  ```javascript
  // Add temp logging in redisSubscriber.js
  console.log('Forwarding to rooms:', rooms);
  ```

### Frontend Debugging

- [ ] Check Socket.io connection:
  ```javascript
  // In browser console
  localStorage.debug = 'socket.io-client:*';
  // Reload page to see connection logs
  ```

- [ ] Check useLiveEvents hook state:
  ```javascript
  // React DevTools > Components > useLiveEvents
  // Check: connected, connecting, events array, error
  ```

- [ ] Check API call for initial load:
  ```javascript
  // Browser DevTools > Network tab
  // Filter "events"
  // Verify GET /api/events/live returns events
  ```

- [ ] Check for console errors:
  ```javascript
  // Browser console should be clear
  // No "Failed to parse event" or Socket errors
  ```

### Network Debugging

- [ ] Verify Socket.io connected to correct URL:
  ```javascript
  // Browser console
  socket.io.engine.opts.host  // Should be localhost:5000
  ```

- [ ] Check CORS headers:
  ```bash
  # In browser Network tab, click on WebSocket upgrade request
  # Verify Access-Control-Allow-Origin header present
  ```

- [ ] Monitor raw WebSocket frames:
  ```bash
  # Browser DevTools > Network > WebSocket
  # Expand "Frames"
  # Should see incoming event data
  ```

---

## 🚀 DEPLOYMENT CHECKLIST

Before pushing to production:

- [ ] All event types have clear, user-friendly messages
- [ ] Sensitive data (PII, passwords) NOT in message/metadata
- [ ] Event types match enum (no typos)
- [ ] Role visibility includes all intended audience
- [ ] Error handling doesn't crash on Redis/Socket.io failure
- [ ] Performance tested with 1000+ events
- [ ] Memory usage stable after extended runtime
- [ ] Event emission non-blocking (async or fire-and-forget)
- [ ] Database indexes created:
  ```javascript
  // Event model should have:
  // db.events.createIndex({ caseId: 1, createdAt: -1 })
  // db.events.createIndex({ type: 1, createdAt: -1 })
  // db.events.createIndex({ createdAt: -1 })
  ```

---

## 📚 REFERENCE FILES

**Copy snippets from:**
- 🎯 `EVENT_CHEAT_SHEET.js` - Quick copy-paste examples
- 📖 `EVENT_IMPLEMENTATION_GUIDE.md` - Detailed explanations
- 📋 `REALTIME_DOCUMENTATION.md` - Full system overview
- 🧪 `TESTING_GUIDE.js` - Comprehensive test procedures

---

## 💬 QUICK Q&A

**Q: Event created but not appearing in UI?**
A: Check order:
1. Is event saved to MongoDB? (Check MongoDB)
2. Is event published to Redis? (Check Redis)
3. Is Socket.io connected? (Check browser WebSocket)
4. Does user's role match visibility? (Check rolesVisibleTo)

**Q: Same event appearing twice?**
A: emitCaseEvent() called twice, or:
- In an event listener that triggers itself
- In multiple route handlers
Solutions: Add check, use event ID deduplication, or remove duplicate call

**Q: Events not visible to specific user?**
A: Check:
1. User role in rolesVisibleTo?
2. User ID in usersVisibleTo (if specified)?
3. JWT token valid?
4. User logged in?

**Q: Socket keeps reconnecting?**
A: Check:
1. Backend server running?
2. MongoDB/Redis accessible?
3. Firewall blocking ports 5000/5173?
4. JWT secret consistent?

---

## 👥 TEAM NOTES

- **Full Documentation:** See REALTIME_DOCUMENTATION.md
- **Implementation Guide:** See EVENT_IMPLEMENTATION_GUIDE.md
- **Quick Reference:** See EVENT_CHEAT_SHEET.js  
- **Test Cases:** See TESTING_GUIDE.js
- **Code Examples:** grep for `emitCaseEvent` in existing routes

---

**Last Updated:** January 2025
**System Status:** ✅ Production Ready
**Coverage:** 11 event types implemented, integrated into 3 core routes
