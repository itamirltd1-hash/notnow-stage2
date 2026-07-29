# NOTNOW Stage 2 — WhatsApp Conversational Scheduling Platform

A multitenant SaaS platform for scheduling messages via WhatsApp using natural language and LLM intent parsing.

## Setup

### 1. Clone & Install

```bash
git clone <repo-url>
cd notnow-stage2
npm install
```

### 2. Database

Create a PostgreSQL database:

```bash
createdb notnow_stage2
```

### 3. Environment Variables

Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

### 4. Run Migrations

```bash
npm run migrate
```

This will execute `src/db/migrations/001-multitenancy.sql` and seed test data.

### 5. Start Server

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

Server will run on `http://localhost:3000`.

Check health: `curl http://localhost:3000/api/health`

---

## Project Structure

```
notnow-stage2/
├── src/
│   ├── db/
│   │   ├── pool.js                      # Postgres connection pool
│   │   ├── multitenancyHelpers.js       # Query builders with user_id scoping
│   │   └── migrations/
│   │       └── 001-multitenancy.sql     # Schema + seed data
│   ├── middleware/
│   │   └── requireUser.js               # User context extraction
│   ├── routes/                          # API routes (Cycles 2-5)
│   ├── llm/                             # LLM integration (Cycle 3)
│   ├── billing/                         # Stripe billing (Cycle 4)
│   └── dispatcher/                      # Message dispatcher (Cycle 5)
├── server.js                            # Express app
├── package.json
├── .env.example
└── README.md
```

---

## API Response Format

All endpoints return a consistent JSON format:

```json
{
  "success": true|false,
  "data": { /* response data */ },
  "error": "error message (only if success=false)"
}
```

---

## Cycles & Features

- **Cycle 1:** ✅ Database Migration & Multitenancy (complete)
- **Cycle 2:** 🔄 User Context & Session Management
- **Cycle 3:** 🔄 Meta WhatsApp API Webhook & LLM Intent Parser
- **Cycle 4:** 🔄 Stripe Billing & Quota Middleware
- **Cycle 5:** 🔄 Enterprise API & Dispatcher Optimization

---

## Development

### Run Tests

```bash
npm test
```

### Database

Access psql:
```bash
psql -d notnow_stage2
```

View schema:
```sql
\dt  -- tables
\di  -- indexes
```

---

## Deployment (Railway)

1. Connect your GitHub repo to Railway
2. Set environment variables in Railway dashboard
3. Deploy via Railway CLI or GitHub push
4. Railway will auto-run migrations on first boot

---

## Support

For issues or questions, check the Planning Documents:
- Cycle 1 Plan: Architecture & Multitenancy
- Cycles 2-5 Plan: Implementation Roadmap
