# 🚀 Real-Time Live Monitoring System

A complete Socket.io-powered real-time event streaming system for the Court Transparency Platform.

## 📋 System Architecture

### Backend Stack
- **MongoDB**: Persistent event storage
- **Redis Pub/Sub**: Real-time event broadcasting channel
- **Socket.io**: WebSocket connection management and room-based filtering
- **Express**: API endpoints for initial load and event history

### Frontend Stack
- **React**: Component framework
- **Socket.io Client**: WebSocket client for real-time connections
- **React Hooks**: State management (useLiveEvents)

## 🏗️ Components

### Backend Files

#### 1. **Event Model** (`backend/src/models/Event.js`)
Stores all case events in MongoDB with role-based visibility.

**Fields:**
- `caseId`: Reference to case
- `type`: enum [STATUS_UPDATE, HEARING_STARTED, DELAY_ALERT, DOCUMENT_UPLOADED, ADJOURNMENT, JUDGMENT, etc.]
- `message`: Human-readable event text
- `createdBy`: User who triggered the event
- `rolesVisibleTo`: Array of roles that can see this event
- `usersVisibleTo`: Array of specific user IDs who can see this event
- `metadata`: Additional context (oldValue, newValue, caseNumber, etc.)

#### 2. **Event Service** (`backend/src/services/eventService.js`)
Core service for emitting and retrieving events.

**Main Functions:**
- `emitCaseEvent(data)` - Saves event to MongoDB + publishes to Redis
- `getVisibleEvents(user, limit, skip)` - Retrieves events visible to user
- `getCaseEvents(caseId, user, limit)` - Gets events for a specific case

**Usage Example:**
```javascript
const { emitCaseEvent } = require('../services/eventService');

await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'STATUS_UPDATE',
  message: 'Case status changed from filed to hearing',
  createdBy: req.user._id,
  metadata: {
    caseNumber: caseDoc.cnr_number,
    oldValue: 'filed',
    newValue: 'hearing',
  },
  rolesVisibleTo: ['admin', 'court_staff', 'advocate', 'victim'],
  usersVisibleTo: [caseDoc.victim_user],
});
```

#### 3. **Redis Subscriber** (`backend/src/services/redisSubscriber.js`)
Bridges Redis Pub/Sub → Socket.io emissions.

**Workflow:**
1. Event published to Redis `case_updates` channel
2. Subscriber listens for messages
3. Forwards to Socket.io clients based on visibility rules

#### 4. **Socket.io Server** (`backend/src/sockets/socketServer.js`)
Manages WebSocket connections and room-based broadcasting.

**Features:**
- JWT authentication via socket handshake
- Room management: `user_<userId>`, `role_<role>`, `case_<caseId>`
- Automatic reconnection handling
- Custom events: `join_case`, `leave_case`, `ping`/`pong`

**Broadcast Methods:**
```javascript
const { getIO, broadcastToRole, broadcastToUser, broadcastToCase } = require('./sockets/socketServer');

const io = getIO();
broadcastToRole('admin', 'live_event', eventPayload);
broadcastToUser(userId, 'live_event', eventPayload);
broadcastToCase(caseId, 'live_event', eventPayload);
```

#### 5. **Events API Routes** (`backend/src/routes/events.routes.js`)
REST endpoints for event history and stats.

**Endpoints:**
- `GET /api/events/live` - Get visible events (paginated, initial load)
- `GET /api/events/case/:caseId` - Get case-specific events
- `GET /api/events/stats` - Get event statistics

### Frontend Files

#### 1. **useLiveEvents Hook** (`frontend/src/hooks/useLiveEvents.js`)
React hook managing Socket.io connection and event state.

**Features:**
- Auto-connects on mount with JWT auth
- Maintains events array (last 100)
- Join/leave case-specific rooms
- Automatic reconnection with backoff

**Usage:**
```javascript
import useLiveEvents from '../hooks/useLiveEvents';

function MyComponent() {
  const { events, connected, connecting, error, joinCase, leaveCase } = useLiveEvents();

  useEffect(() => {
    if (caseId) {
      joinCase(caseId);
      return () => leaveCase(caseId);
    }
  }, [caseId, joinCase, leaveCase]);

  return (
    <div>
      {events.map(event => (
        <div key={event._id}>{event.message}</div>
      ))}
    </div>
  );
}
```

#### 2. **Event Service** (`frontend/src/services/eventService.js`)
API client for fetching event history.

```javascript
import eventService from '../services/eventService';

// Get initial events
const result = await eventService.getLiveEvents({ limit: 20, skip: 0 });

// Get events for specific case
const caseEvents = await eventService.getCaseEvents(caseId, 50);

// Get stats
const stats = await eventService.getEventStats();
```

#### 3. **LiveMonitoringCard Component** (`frontend/src/components/live/LiveMonitoringCard.jsx`)
Real-time event feed displaying in the sidebar on all dashboards.

**Features:**
- Displays latest 5-10 events
- Live connection indicator (blinking dot)
- Event type badges with colors
- Relative timestamps (now, 5m ago, etc.)
- Scrollable history
- Role-based filtering (handled server-side)

---

## 🔌 Integration Points

### Where Events Are Emitted (Controllers)

#### Case Status Updates (`case.routes.js`)
```javascript
// When case status changes
await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'STATUS_UPDATE',
  message: `Case status changed from ${oldStatus} to ${status}`,
  // ... visibility rules
});
```

#### Document Uploads (`document.routes.js`)
```javascript
// When document is uploaded
await emitCaseEvent({
  caseId: caseDoc._id,
  type: 'DOCUMENT_UPLOADED',
  message: `Document uploaded: ${filename}`,
  // ... visibility rules
});
```

#### Case Events / Adjournments (`case.routes.js`)
```javascript
// When adjournment, hearing, judgment, etc. are added
await emitCaseEvent({
  caseId: caseDoc._id,
  type: event_type === 'adjournment' ? 'ADJOURNMENT' : 'HEARING_STARTED',
  message: event_description,
  // ... visibility rules
});
```

---

## 🔐 Role-Based Visibility

Events filtered at server-side via `rolesVisibleTo` and `usersVisibleTo`:

| Role | Can See |
|------|---------|
| **admin** | All events |
| **court_staff** | All events |
| **advocate** | Events for cases they work on + own user events |
| **victim** | Events for their case + alerts targeted to them |
| **visitor** | Only anonymized/public events |

---

## 🧪 Testing the System

### 1. Start Backend
```bash
cd backend
npm install
npm run dev
```

### 2. Start Frontend
```bash
cd frontend
npm install
npm run dev
```

### 3. Open Multiple Tabs
- Tab 1 (logged as **victim**): `http://localhost:5173/dashboard/victim`
- Tab 2 (logged as **admin**): `http://localhost:5173/dashboard/admin`
- Tab 3 (public): `http://localhost:5173/dashboard/public`

### 4. Trigger Events via API
Upload document as victim or update case status as admin/staff:

```bash
# Upload document (victim)
curl -X POST http://localhost:5000/api/documents/:caseId/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "document=@file.pdf" \
  -F "doc_type=evidence"

# Update case status (admin/staff)
curl -X PATCH http://localhost:5000/api/cases/:caseId/status \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "hearing", "next_hearing_date": "2025-12-31T10:00:00Z"}'
```

### 5. Watch Real-Time Updates
Events should appear instantly in all connected dashboards without page refresh.

---

## 📊 Event Types

| Type | Triggered By | Visibility |
|------|--------------|-----------|
| **STATUS_UPDATE** | Case status change | admin, court_staff, advocate, victim |
| **HEARING_STARTED** | Hearing added | admin, court_staff, advocate, victim |
| **HEARING_SCHEDULED** | Future hearing added | admin, court_staff, advocate, victim |
| **DELAY_ALERT** | Delay detected | admin, court_staff, advocate |
| **DOCUMENT_UPLOADED** | Document upload | admin, court_staff, advocate, victim |
| **ADJOURNMENT** | Adjournment added | admin, court_staff, advocate, victim |
| **JUDGMENT** | Judgment issued | admin, court_staff, advocate, victim |
| **STAGNATION_FLAG** | Case stagnation detected | admin, court_staff |
| **VERIFICATION_COMPLETE** | Document verified | admin, court_staff, victim |
| **ADMIN_NOTE** | Admin adds note | admin, court_staff |

---

## 🚀 Performance Optimizations

### Redis Pub/Sub Scaling
- Events streamed via Redis channel, not stored in memory
- Horizontal scaling: Multiple server instances share Redis channel
- No WebSocket connection overhead between instances

### Database Indexing
Event model indexed on:
- `caseId + createdAt` (case history queries)
- `type + createdAt` (event type filtering)
- `createdAt` (general pagination)

### Client-Side Pagination
- Hook maintains max 100 events in memory
- `getVisibleEvents()` uses MongoDB skip/limit
- UI shows 5-10 events, scroll for more

---

## ⚠️ Error Handling

### On Socket Disconnection
- Frontend automatically reconnects with exponential backoff
- All missed events fetched via `getVisibleEvents()` on reconnect
- User sees "Offline" indicator until reconnected

### On Emission Failure
- Event failures logged but don't block case operations
- Events still saved to MongoDB even if Redis/Socket.io fails
- Retry on next app restart

---

## 📝 Environment Variables

Ensure these are set:

```env
# Backend
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/db
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key

# Frontend (.env)
VITE_API_BASE_URL=http://localhost:5000
```

---

## 🔍 Debugging

### Enable Verbose Logging
```javascript
// In socketServer.js, enable debug mode:
socketIo(httpServer, {
  debug: true,
  // ... other options
});
```

### Monitor Redis Channel
```bash
redis-cli subscribe case_updates
```

### Browser DevTools
```javascript
// In browser console
localStorage.debug = 'socket.io-client:socket';
// Reload page
```

---

## 🎯 Next Steps

1. **Delay Detection Events**: Emit DELAY_ALERT automatically when delay thresholds hit
2. **Event Aggregation**: Group similar events (e.g., multiple adjournments)
3. **Event History UI**: Add dedicated event history page with filtering
4. **Push Notifications**: Send email/SMS for critical events
5. **Event Webhooks**: Allow external systems to subscribe to events

---

## 📚 File Structure

```
backend/
├── models/
│   └── Event.js
├── services/
│   ├── eventService.js
│   └── redisSubscriber.js
├── sockets/
│   └── socketServer.js
├── routes/
│   └── events.routes.js
└── app.js (updated with Socket.io init)

frontend/
├── hooks/
│   └── useLiveEvents.js
├── services/
│   └── eventService.js
├── components/
│   └── live/
│       └── LiveMonitoringCard.jsx
└── layouts/
    └── Sidebar.jsx (updated)
```

---

## ✅ Verification Checklist

- [x] Event model created
- [x] Event service with emitCaseEvent()
- [x] Redis Pub/Sub bridge
- [x] Socket.io server initialization
- [x] Events API routes
- [x] Case controller integration
- [x] Document controller integration
- [x] useLiveEvents React hook
- [x] LiveMonitoringCard component
- [x] Frontend Socket.io client
- [x] Real-time event display in sidebar
- [x] Role-based filtering
- [x] Initial event load on app start
- [x] Production builds pass

---

**System is production-ready for real-time court case monitoring.**
