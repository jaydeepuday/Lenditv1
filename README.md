# LendIT Monorepo

Welcome to the LendIT rental marketplace. This repository uses a clean monorepo architecture separating the backend and frontend while allowing simultaneous local development.

## Project Structure
- `apps/backend`: NestJS + Prisma + PostgreSQL + Redis
- `apps/frontend`: Vanilla JS/HTML SPA

## 1. Setup

### Prerequisites
- **Node.js**: v18+ (v24 recommended)
- **Database**: PostgreSQL (v16+)
- **Cache**: Redis (v7+)
- **Package Manager**: npm

### Installation
From the project root:
```bash
npm install
```

### Infrastructure (Local)
If you have Docker installed, you can easily spin up the required PostgreSQL and Redis instances:
```bash
docker-compose up -d postgres redis
```

---

## 2. Environment Variables

The backend relies on environment variables defined in `apps/backend/.env`. Copy `.env.example` to `.env` and fill in the values:

```env
# Core API Config
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000

# Database & Cache
DATABASE_URL="postgresql://user:password@localhost:5432/db_name"
REDIS_HOST=localhost
REDIS_PORT=6379

# Authentication Security
JWT_ACCESS_SECRET="your_secure_access_secret_here"
JWT_REFRESH_SECRET="your_secure_refresh_secret_here"
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
OTP_EXPIRY_MINUTES=5
OTP_MAX_ATTEMPTS=3

# Email Configuration (Resend)
# Leave RESEND_API_KEY empty in dev to fallback to console-logging emails
RESEND_API_KEY="your_resend_api_key"
EMAIL_FROM="lendIT <onboarding@resend.dev>"

# Marketplace Configuration
PLATFORM_FEE_PERCENT=5
WALLET_MIN_WITHDRAWAL=100
```

*Note: The frontend does not currently require environment variables as API routing relies on hardcoded paths designed for single-server or specific backend URLs.*

---

## 3. Startup

To run the entire application stack locally for development:

```bash
npm run dev
```

This single command utilizes `concurrently` to:
1. Start the **NestJS Backend** API on `http://localhost:3001` (in watch mode)
2. Start the **Vanilla Frontend** static server on `http://localhost:3000`

*Important: During local development, the frontend relies on cross-origin requests to port 3001. Ensure CORS is correctly configured in `main.ts` (currently enabled).*

---

## 4. Deployment Notes

While the system can currently run on a single machine (with NestJS serving the static frontend files fallback), it is highly recommended to split deployments at scale:

- **Frontend (Vercel / Netlify)**:
  - Serve the `apps/frontend` directory as static assets.
  - *Action Required*: Before deploying independently, update `api.js` and `main.js` to dynamically inject the production Backend URL instead of using hardcoded `localhost:3001` endpoints.
- **Backend (Render / Railway / AWS)**:
  - Configure `FRONTEND_URL` to match your Vercel URL to prevent CORS/cookie issues.
  - Run the backend via standard npm scripts:
    ```bash
    npm run build --prefix apps/backend
    npm run start:prod --prefix apps/backend
    ```
- **Database Migrations**: Remember to run `npx prisma deploy` (or `push`) in your CI/CD pipeline against your production PostgreSQL instance.
