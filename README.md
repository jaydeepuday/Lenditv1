# LendIT — Campus Lending Platform

> Peer-to-peer item rental marketplace for college students. Borrow & lend textbooks, electronics, sports gear and more — secured by escrow, OTP verification, and real-time chat.

## Architecture

```
LendITv2/
├── apps/
│   ├── backend/     # NestJS REST API + Socket.IO WebSocket Gateway
│   └── frontend/    # Vanilla JS SPA (hash-based routing)
├── docker-compose.yml
└── package.json     # Monorepo root (concurrently)
```

| Layer | Stack |
|---|---|
| **Frontend** | Vanilla JavaScript, HTML5, CSS3, Socket.IO Client (ESM) |
| **Backend** | NestJS, Prisma ORM, PostgreSQL, Redis, Socket.IO |
| **Auth** | JWT (httpOnly cookies), Email OTP via Resend |
| **Payments** | Wallet-based escrow with platform fee split |

## Features

- **Browse & List** — Search, filter by category, and list items with compressed image uploads
- **Time-Slot Rentals** — Hourly / daily pricing with turnover conflict detection
- **Secure Checkout** — 10-minute reservation window, wallet hold → escrow → payout pipeline
- **OTP Verification** — 6-digit pickup and return codes prevent unauthorized handoffs
- **Real-Time Chat** — Socket.IO namespace-based messaging with contact-info filtering
- **Notifications** — In-app toasts, browser notifications, and email alerts
- **Admin Dashboard** — User reports, item moderation, and system stats
- **Concurrency Safe** — Advisory locks, row-level locking, idempotency guards

## Prerequisites

- **Node.js** v18+ (v24 recommended)
- **PostgreSQL** v16+
- **Redis** v7+
- **npm**

## Quick Start

### 1. Install dependencies

```bash
npm install
cd apps/backend && npm install
cd ../frontend && npm install
```

### 2. Infrastructure (Docker)

```bash
docker-compose up -d postgres redis
```

### 3. Configure environment

Copy the example and fill in your values:

```bash
cp apps/backend/.env.example apps/backend/.env
```

Required variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_HOST` / `REDIS_PORT` | Redis connection |
| `JWT_ACCESS_SECRET` | Random string for access tokens |
| `JWT_REFRESH_SECRET` | Random string for refresh tokens |
| `RESEND_API_KEY` | Resend email API key (optional in dev) |
| `FRONTEND_URL` | Frontend origin for CORS |

> **⚠️ Never commit `.env` files.** The `.gitignore` already excludes them.

### 4. Database setup

```bash
cd apps/backend
npx prisma db push
```

### 5. Run locally

```bash
# From project root — starts both backend (port 3001) and frontend (port 3000)
npm run dev
```

## Deployment

| Component | Recommended | Notes |
|---|---|---|
| **Frontend** | Vercel / Netlify | Serve `apps/frontend` as static assets. Update `BACKEND_URL` in `api.js`. |
| **Backend** | Render / Railway | Set `FRONTEND_URL` for CORS. Run `npx prisma db push` in CI/CD. |
| **Database** | Supabase / Neon / RDS | Managed PostgreSQL with connection pooling. |

**Production build:**

```bash
npm run build --prefix apps/backend
npm run start:prod --prefix apps/backend
```

## Testing

```bash
cd apps/backend
npm run test:e2e
```

Integration tests verify concurrency safety (double-spend prevention), idempotency (duplicate return guard), and access control invariants.

## License

Private — All rights reserved.
