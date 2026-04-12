# 🚀 QUICK REFERENCE CARD

## Public Real-Time Tracking - 30 Seconds

### Setup
```bash
npm run seed:demo          # Load demo cases (3 courts, 3 cases, 7 events)
npm run dev               # Start backend on :5000
cd ../frontend && npm run dev  # Start frontend on :5173
```

### Access
```
PUBLIC (NO LOGIN):    http://localhost:5173/dashboard/public
WITH LOGIN:          http://localhost:5173/login
Test Credentials:    victim@example.com / hashed_password
```

### See It Live
```
1. Open public dashboard (no login needed)
2. See real-time case updates
3. Open another tab with login
4. Update a case status
5. Public tab updates automatically ✨
```

---

## 📊 What You Get

| Feature | Status | Details |
|---------|--------|---------|
| 🌐 Public access | ✅ | No login required |
| ⚡ Real-time sync | ✅ | < 1 second latency |
| 📱 Multi-device | ✅ | All tabs sync automatically |
| 🔐 Role-based | ✅ | Each user sees appropriate events |
| 📄 Demo data | ✅ | 3 cases with full lifecycle |
| 📡 Socket.io | ✅ | WebSocket + fallback |

---

## 🔄 Event Types Generated

- `STATUS_UPDATE` - Case status changes (visible to public)
- `HEARING_SCHEDULED` - Hearing date added (visible to public)
- `DOCUMENT_UPLOADED` - Document added to case (visible to public)
- `JUDGMENT` - Judgment issued (visible to public)
- `DELAY_ALERT` - Case delayed (staff only)
- `ADMIN_NOTE` - Internal notes (staff only)
- `STAGNATION_FLAG` - Case inactive (staff only)

---

## 📡 API Endpoints

### Public (No Auth)
```bash
GET /api/events/public?limit=20&skip=0
# Returns public-visible events
```

### Authenticated
```bash
GET /api/events/live
# Returns role-filtered events

GET /api/events/case/:caseId
# Returns case-specific events
```

---

## 🔧 Troubleshooting

| Error | Fix |
|-------|-----|
| "No events" | `npm run seed:demo` |
| "Socket error" | Check backend running: `curl http://localhost:5000` |
| "Slow updates" | Check Redis: `redis-cli ping` |
| "Blank page" | Check MongoDB: `mongosh` |

---

## 📚 Documentation

- **Setup:** `PUBLIC_REALTIME_QUICK_START.md`
- **Architecture:** `REALTIME_DOCUMENTATION.md`
- **Data Sources:** `REALTIME_DATA_SOURCES.md`
- **Event Examples:** `EVENT_CHEAT_SHEET.js`
- **Implementation:** `EVENT_IMPLEMENTATION_GUIDE.md`
- **Testing:** `TESTING_GUIDE.js`
- **Checklist:** `IMPLEMENTATION_CHECKLIST.md`
- **Summary:** `IMPLEMENTATION_COMPLETE.md`

---

## ✅ Verification

```bash
# 1. Seed demo data
npm run seed:demo
# ✓ 4 users, 3 cases, 7 events created

# 2. Check MongoDB
mongosh
db.events.countDocuments()  # Should show ~7

# 3. Check Redis
redis-cli subscribe case_updates
# ✓ Ready to receive events

# 4. Start servers
npm run dev                      # Terminal 1: Backend
cd frontend && npm run dev       # Terminal 2: Frontend

# 5. Test
http://localhost:5173/dashboard/public
# ✓ See live events (no login)
```

---

## 🎯 Key Endpoints

```
FRONTEND:
  Public:     http://localhost:5173/dashboard/public
  Login:      http://localhost:5173/login
  Victim:     http://localhost:5173/dashboard/victim
  Advocate:   http://localhost:5173/dashboard/advocate
  Admin:      http://localhost:5173/dashboard/admin

BACKEND API:
  Public Events:  GET http://localhost:5000/api/events/public
  Live Events:    GET http://localhost:5000/api/events/live
  Case Events:    GET http://localhost:5000/api/events/case/:id
  Event Stats:    GET http://localhost:5000/api/events/stats
```

---

## 💾 Demo Data Included

After `npm run seed:demo`:

**Users:** 
- victim@example.com
- advocate@example.com  
- staff@example.com
- admin@example.com

**Cases:** 3 realistic court cases
**Events:** 7 sample lifecycle events
**Documents:** 3 uploaded files
**Courts:** 4 different jurisdictions

---

## 🔐 What Public Sees vs Private

| Type | Public Sees | Logged-In Sees |
|------|-----------|----------------|
| Case Status | ✅ Yes | ✅ Yes |
| Hearings | ✅ Yes | ✅ Yes |
| Documents | ✅ Yes | ✅ Yes |
| Judgments | ✅ Yes | ✅ Yes |
| Admin Notes | ❌ No | ✅ Yes (if staff) |
| Delays/Flags | ❌ No | ✅ Yes (if staff) |

---

## 📊 Real-Time Flow

```
User Action
    ↓
Express Route
    ↓
MongoDB + Redis
    ↓
Socket.io Broadcast
    ↓
Browser Update
_________(< 1 second)
```

---

## 🎉 You're All Set!

Non-logged users now have **complete real-time transparency** into case progress.

**Next Steps:**
1. Run `npm run seed:demo`
2. Start backend & frontend
3. Visit http://localhost:5173/dashboard/public
4. See live updates (no login!)

**Questions?** Check the documentation files in project root.

