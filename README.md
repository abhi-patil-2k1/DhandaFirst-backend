# GrowLocal - Local Business Growth Platform

An open-source SaaS platform for managing Google Business Profiles, reviews, and local business growth.

## Architecture

```
├── apps/
│   ├── frontend/          # Next.js 14 (App Router) + shadcn/ui
│   └── backend/           # NestJS + Prisma + PostgreSQL
├── packages/
│   └── shared-types/      # Shared TypeScript types
├── docker/                # Dockerfiles
└── docs/                  # Documentation
```

### Tech Stack

| Layer          | Technology                              |
| -------------- | --------------------------------------- |
| Frontend       | Next.js 14, TypeScript, Tailwind, shadcn/ui, Zustand, TanStack Query |
| Backend        | NestJS, TypeScript, Prisma, PostgreSQL  |
| Auth           | Google OAuth 2.0 + JWT                  |
| AI             | OpenAI API (optional)                   |
| Job Processing | PostgreSQL job table + cron worker      |
| Hosting        | Docker Compose (any cloud/VPS)          |

### Backend Modules

- **Auth** — Google OAuth login, JWT session management, encrypted token storage
- **Business** — Connect/manage Google Business Profile locations
- **Review** — Fetch, display, filter, reply to reviews (manual + AI)
- **Dashboard** — Stats, trends, charts (reviews over time, rating trends)
- **Insights** — Actionable recommendations (unreplied reviews, rating drops)
- **Jobs** — PostgreSQL-based async job queue with cron worker
- **Settings** — User preferences, theme, notification toggles

### Key Design Decisions

- **No Redis/BullMQ** — Job queue uses a PostgreSQL `jobs` table with a cron worker that polls every 60 seconds. Supports idempotency, retries (max 3), stale lock cleanup, and failure logging.
- **Multi-tenant** — Every query is scoped by `userId`. No cross-tenant data leakage.
- **No vendor lock-in** — Prisma abstracts the database layer. Works with any PostgreSQL (Supabase, RDS, self-hosted).
- **Encrypted tokens** — Google OAuth tokens are AES-256-GCM encrypted at rest.

## Setup

### Prerequisites

- Node.js >= 18
- PostgreSQL (or Docker)
- Google Cloud Console project with OAuth 2.0 credentials and Business Profile API enabled

### 1. Clone and install

```bash
git clone <repo-url>
cd local-business-growth-platform
npm install
```

### 2. Configure environment

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env.local
```

Edit `apps/backend/.env` with your credentials:
- `DATABASE_URL` — PostgreSQL connection string
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from Google Cloud Console
- `JWT_SECRET` — random secret for JWT signing
- `ENCRYPTION_KEY` — 32-character key for token encryption
- `OPENAI_API_KEY` — (optional) for AI review replies

### 3. Setup database

```bash
cd apps/backend
npx prisma migrate dev
npx prisma generate
```

### 4. Run development

```bash
# From root
npm run dev:backend   # http://localhost:4000
npm run dev:frontend  # http://localhost:3000
```

API docs available at `http://localhost:4000/api/docs`

### 5. Docker (production)

```bash
docker compose up -d
```

## API Endpoints

All endpoints are prefixed with `/api/v1/`.

| Method | Path                              | Description                |
| ------ | --------------------------------- | -------------------------- |
| GET    | `/auth/google`                    | Initiate Google OAuth      |
| GET    | `/auth/google/callback`           | OAuth callback             |
| GET    | `/auth/me`                        | Get current user           |
| GET    | `/businesses`                     | List connected businesses  |
| POST   | `/businesses/connect`             | Connect a business         |
| DELETE | `/businesses/:id`                 | Disconnect a business      |
| GET    | `/reviews/business/:id`           | List reviews (filtered)    |
| POST   | `/reviews/business/:id/sync`      | Sync reviews from Google   |
| POST   | `/reviews/:id/reply`              | Reply to a review          |
| POST   | `/reviews/:id/ai-reply`           | Generate AI reply          |
| GET    | `/dashboard/stats`                | Dashboard statistics       |
| GET    | `/insights`                       | Actionable insights        |
| GET    | `/settings`                       | Get user settings          |
| PATCH  | `/settings`                       | Update settings            |
| POST   | `/jobs`                           | Create async job           |
| GET    | `/jobs`                           | List user's jobs           |

## Google Cloud Setup

1. Create a project in [Google Cloud Console](https://console.cloud.google.com)
2. Enable the **Google Business Profile API** (My Business Account Management API, My Business Business Information API)
3. Create **OAuth 2.0 credentials** (Web application type)
4. Set authorized redirect URI: `http://localhost:4000/api/v1/auth/google/callback`
5. Add scopes: `email`, `profile`, `https://www.googleapis.com/auth/business.manage`

## License

MIT
