# 🏛️ Court Transparency & Justice Accountability System

> Real-time court case tracking, delay detection, and accountability — powered by MongoDB + Redis + AI.

## 📁 Project Structure

```
nosql project/
├── backend/                 # Node.js + Express API
│   ├── src/
│   │   ├── config/          # Database, Redis, env config
│   │   ├── middleware/      # Auth, RBAC, error handling
│   │   ├── models/          # Mongoose models (8 collections)
│   │   ├── routes/          # API route handlers
│   │   ├── services/        # Business logic
│   │   ├── workers/         # BullMQ background workers
│   │   ├── utils/           # Logger, anonymizer, validators
│   │   └── app.js           # Express entry point
│   ├── uploads/             # Uploaded documents
│   ├── package.json
│   └── .env
├── frontend/                # React + Vite SPA
│   ├── src/
│   │   ├── pages/           # Victim Portal, Public Dashboard, Admin
│   │   ├── components/      # Reusable UI components
│   │   ├── hooks/           # Custom React hooks
│   │   ├── services/        # API client (Axios)
│   │   ├── context/         # Auth context
│   │   └── App.jsx
│   ├── package.json
│   └── vite.config.js
├── docker-compose.yml       # MongoDB + Redis + Backend
└── README.md
```

## 🚀 Quick Start (Local)

### Backend
```bash
cd backend
npm install
node src/models/seed.js     # Seed sample data
node src/app.js              # Start API on port 5000
```

### Frontend
```bash
cd frontend
npm install
npm run dev                  # Start React on port 5173
```

### Health Check
```
GET http://localhost:5000/health
GET http://localhost:5000/api
```

## ⚙️ Tech Stack

| Layer | Technology |
|:------|:-----------|
| Database | MongoDB (local or Atlas) |
| Cache/Queue | Redis (local or Upstash) |
| Backend | Node.js + Express |
| Frontend | React + Vite |
| AI | Google Gemini (optional) |

## 📧 Test Accounts

| Role | Email | Password |
|:-----|:------|:---------|
| Admin | admin@courtsystem.in | admin123 |
| Victim | victim@test.com | victim123 |
