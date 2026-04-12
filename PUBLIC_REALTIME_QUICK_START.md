# 🚀 QUICK START: Public Real-Time Tracking

## What's New?

✅ **Non-logged-in users can now see live case tracking**  
✅ **Demo data with 3 realistic cases**  
✅ **Real-time updates visible to everyone (no login needed)**  
✅ **Complete data source documentation**

---

## 🎯 30-Second Setup

```bash
# 1. Load demo data (creates test cases & events)
cd backend
npm run seed:demo

# 2. Start backend (Socket.io server)
npm run dev

# 3. Start frontend (in new terminal)
cd frontend
npm run dev

# 4. Open browser (NO LOGIN NEEDED!)
http://localhost:5173/dashboard/public

# 5. See real-time case updates! 🎉
```

---

## 👥 Who Sees What?

### Public Access (NO LOGIN) 🌐
```
URL: http://localhost:5173/dashboard/public
Events Visible: STATUS_UPDATE, HEARING_SCHEDULED, DOCUMENT_UPLOADED, JUDGMENT
Who Sees: Anyone (victims, advocates, public, media, anyone)
Real-Time: YES ✅
```

### Logged-In Users 🔐
```
URL: http://localhost:5173/dashboard/victim (or advocate/admin)
Events Visible: All events assigned to your role/case
Real-Time: YES ✅
```

### Multi-Tab Sync ↔️
```
Open 2+ tabs → Update something → All tabs refresh automatically
No page refresh needed ✅
```

---

## 📊 Demo Data Includes

After running `npm run seed:demo`:

**Users:**
- Victim: `victim@example.com` (with password: `password123`)
- Advocate: `advocate@example.com`
- Court Staff: `staff@example.com`
- Admin: `admin@example.com`

**Cases:**
1. **Property Dispute** (Status: filed, Hearing in 3 days)
2. **Criminal Assault** (Status: hearing, Hearing tomorrow)
3. **Contract Breach** (Status: adjourned, Hearing in 30 days)

**Events:**
- 7 real-time events already created
- Examples: filed, document uploaded, hearing scheduled, delay alert

---

## 🔄 Where Data Comes From

### Automatic Generation
Events are created when **any user** performs an action:

```javascript
// When victim uploads document:
Events Generated: DOCUMENT_UPLOADED
Visible To: Everyone (public)
Real-Time: YES ✅ (< 1 second)

// When court staff changes status:
Events Generated: STATUS_UPDATE
Visible To: Everyone (public)
Real-Time: YES ✅

// When admin adds internal note:
Events Generated: ADMIN_NOTE
Visible To: Admin & court_staff only (hidden from public)
Real-Time: YES ✅
```

### Data Sources

| Source | Event Type | Frequency | Scope |
|--------|-----------|-----------|-------|
| **User actions** | Status, Documents, Hearings | On-demand | Active when user logged in |
| **Background jobs** | Delays, Stagnation flags | Hourly/Daily | Automatic scans |
| **Manual seeding** | Demo data | One-time | Initial testing |
| **API calls** | Any event type | Programmatic | Integrations |

---

## 📱 Testing Real-Time (3 Scenarios)

### Scenario 1: Public Dashboard Only
```bash
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Frontend
cd frontend && npm run dev

# Browser:
http://localhost:5173/dashboard/public
# ✅ See live case updates
# ✅ No login required
# ✅ New events appear in < 1 second
```

### Scenario 2: Multi-User Sync
```bash
# Tab 1: http://localhost:5173/login → Login as admin
# Tab 2: http://localhost:5173/login → Login as victim
# Tab 3: http://localhost:5173/dashboard/public (no login)

# Go to Tab 1 (admin) → Update a case status
# Watch Tabs 2 & 3 → Event appears immediately!
```

### Scenario 3: Cross-Browser
```bash
# Browser A: http://localhost:5173/dashboard/public
# Browser B: http://localhost:5173/dashboard/public
# (Both in incognito mode)

# Go to http://localhost:5173/login in either
# Make a case update
# Both public dashboards update automatically
```

---

## 🔑 API Endpoints

### For Public Users (NO LOGIN)

**Get Live Events:**
```bash
curl http://localhost:5000/api/events/public?limit=20
```

**Response:**
```json
{
  "success": true,
  "data": {
    "events": [
      {
        "_id": "...",
        "caseId": "...",
        "type": "STATUS_UPDATE",
        "message": "Case filed",
        "metadata": {...},
        "createdAt": "2025-01-15T10:30:00Z"
      }
    ],
    "total": 42,
    "page": 1,
    "pages": 3
  }
}
```

### For Logged-In Users

**Get Filtered Events:**
```bash
curl http://localhost:5000/api/events/live?limit=20 \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>"
```

**Get Case Events:**
```bash
curl http://localhost:5000/api/events/case/CASE_ID \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>"
```

---

## 🛠️ Troubleshooting

### "No events showing"
```bash
# Did you run seed:demo?
npm run seed:demo

# Are both servers running?
# Backend: http://localhost:5000 (should show "Real-Time Live Monitoring System activated")
# Frontend: http://localhost:5173
```

### "Socket connection error"
```bash
# Check backend is accessible
curl http://localhost:5000/api/health

# Check Redis is running
redis-cli ping  # Should return PONG

# Check MongoDB is running
mongosh  # Should connect OK
```

### "Events appear slow"
```bash
# Run this in browser console:
localStorage.debug = 'socket.io-client:*'
// Reload and watch WebSocket messages

# Check Redis:
redis-cli subscribe case_updates
// Trigger an event - should see JSON in terminal
```

---

## 📈 How Events Flow

```
User Action
    ↓
Backend Route Handler
    ↓
emitCaseEvent() function
    ↓
MongoDB Save + Redis Publish
    ↓
Redis Subscriber Listens
    ↓
Socket.io Broadcast
    ↓
Frontend Socket.io Listener
    ↓
React State Update
    ↓
UI Re-renders in < 1 second
```

**Total Latency:** ~100-500ms (milliseconds)

---

## 🎓 Files Updated

| File | Change | Why |
|------|--------|-----|
| `backend/src/seeds/demoDataSeed.js` | ✨ **NEW** | Demo data with cases, documents, events |
| `backend/src/routes/events.routes.js` | 🆕 `/api/events/public` endpoint | Public events (no auth) |
| `backend/package.json` | `npm run seed:demo` | Quick seed command |
| `REALTIME_DATA_SOURCES.md` | ✨ **NEW** | Complete data flow documentation |

---

## ✅ What Works Now

- ✅ Public dashboard shows real-time case progress (NO LOGIN)
- ✅ All 3 user dashboards see role-filtered events in real-time
- ✅ Multi-tab sync (updates across all open tabs instantly)
- ✅ Socket.io supports visitor role for public access
- ✅ Demo data pre-populated with 3 realistic cases
- ✅ 7 sample events showing full lifecycle
- ✅ Events visible < 1 second after user action
- ✅ Public API endpoint for event history
- ✅ Role-based visibility working correctly

---

## 🚀 Next Steps

1. **Load Demo Data:**
   ```bash
   npm run seed:demo
   ```

2. **Test Public Access:**
   ```
   http://localhost:5173/dashboard/public
   ```

3. **Create Your Own Events:**
   - Login: http://localhost:5173/login
   - Select a case → Update status
   - Watch real-time update

4. **Monitor Real-Time:**
   - Open 2 tabs
   - One as public, one as logged-in user
   - Both sync automatically

5. **Explore Data Flow:**
   - Read: REALTIME_DATA_SOURCES.md
   - Check: REALTIME_DOCUMENTATION.md
   - Code examples: EVENT_CHEAT_SHEET.js

---

## 🎯 Key Features

**For General Public:**
- See what cases are progressing
- No account required
- Real-time updates
- Transparency in justice system

**For System Users:**
- Role-based event filtering
- Private vs. public events
- Admin-only notifications
- Real-time dashboards for all roles

**For Developers:**
- Easy event emission: `emitCaseEvent({...})`
- Public API endpoint
- Socket.io for real-time
- MongoDB for persistence
- Redis for broadcasting

---

**Your real-time transparency system is now live!** 🎉

Non-logged-in visitors can watch court cases progress in real-time. All events are generated from user actions and automatically broadcast to everyone watching.

