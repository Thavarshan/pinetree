# 🌲 Pinetree – chat time tracking MVP (Slack) (monorepo)

Production-shaped MVP that logs time-tracking events from a Slack chat bot into a DB (Postgres) and exports CSV/XLSX.

This README is both:

- a developer-facing technical document (architecture, DB model, API reference, operations)
- a user guide for the bot UX (what to type/click, what gets stored, how exports work)

## Table of contents

- [Monorepo layout](#monorepo-layout)
- [Architecture](#architecture)
- [Prereqs](#prereqs)
- [Setup (local dev)](#setup-local-dev)
- [Configuration](#configuration)
- [Slack bot setup](#slack-bot-setup)
- [User guide (in chat)](#user-guide-in-chat)
- [API reference](#api-reference)
- [Data model](#data-model)
- [Exports](#exports)
- [Security](#security)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## Monorepo layout

- `apps/api` – Express webhook receiver + export endpoints
- `packages/db` – Prisma schema + generated client
- `packages/core` – shared types, parsing, timezone utils
- `packages/exporter` – CSV/XLSX generation + summary worksheet logic

## Architecture

High-level flow:

1. A chat message is delivered to `POST /webhook/slack`.
2. The API parses the message into a normalized “event” (start, break start/end, end, status, menu, etc.).
3. The API stores the event in the database with idempotency (retries are safe).
4. Admin exports are served from `GET /export/csv` and `GET /export/xlsx`.

Key design points:

- **Idempotency**: We store `Event.sourceMessageId` with a unique constraint to prevent duplicate events.
- **Postgres-first**: Prisma is configured for Postgres (recommended for Railway and local dev).
- **Separation of concerns**:
  - parsing/timezone utilities: `packages/core`
  - export formatting + summary logic: `packages/exporter`
  - schema + Prisma client: `packages/db`
  - HTTP and webhook glue: `apps/api`

## Prereqs

- Node.js 20+ (this repo was scaffolded with Node 25)
- `pnpm` 9.x (`npm i -g pnpm@9.15.0`)

## Setup (local dev)

1. Install deps:

```bash
pnpm install
```

1. Configure env:

- Copy `.env.example` → `.env` and fill values.
  For local dev DB, use Postgres:

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/pinetree?schema=public"
```

Note: this repo’s `docker-compose.yml` maps Postgres to host port `5433` to avoid clashing with an existing local Postgres on `5432`.

1. Run migrations:

```bash
pnpm --filter @pinetree/db prisma:migrate
```

1. Run dev server:

```bash
pnpm dev
```

API runs on `http://localhost:3000`.

## Configuration

Environment variables are read by `apps/api`.

Create `.env` from `.env.example`. Minimal local dev setup:

```env
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/pinetree?schema=public"
ADMIN_API_KEY="dev-secret"
TIMEZONE="UTC"
PUBLIC_BASE_URL=""
SLACK_SIGNING_SECRET=""
SLACK_BOT_TOKEN=""
PORT="3000"
```

### Environment variable reference

- `DATABASE_URL` (required)
  - Postgres: `postgresql://user:pass@host:port/db?schema=public`
- `ADMIN_API_KEY` (required for exports)
  - Used by export endpoints as `x-api-key`.
- `TIMEZONE` (required)
  - IANA timezone (e.g. `UTC`, `Asia/Jerusalem`, `Europe/London`).
  - Used for date-range interpretation and local time formatting in exports.
- `PUBLIC_BASE_URL` (optional)
  - Public https URL used by webhook configuration and some bot messaging.
  - Can be an empty string in local dev.
- `SLACK_SIGNING_SECRET` (optional)
  - Required to accept requests on `POST /webhook/slack`.
- `SLACK_BOT_TOKEN` (optional)
  - Required if you want the server to send messages back to Slack.
- `PORT` (optional)
  - Defaults to `3000`.

## Scripts

From repo root:

- `pnpm dev` – run the API in watch mode
- `pnpm build` – build all packages
- `pnpm typecheck` – TypeScript typecheck across packages
- `pnpm lint` – ESLint across packages
- `pnpm format` – auto-format with Prettier (writes changes)
- `pnpm format:check` – verify formatting (no writes; fails on drift)
- `pnpm test` – unit tests + integration tests

Notes:

- ESLint is configured to work with Prettier: conflicting style rules are disabled and formatting drift is reported as `prettier/prettier` lint errors.
- If `pnpm lint` reports formatting issues, run `pnpm format` and re-run `pnpm lint`.

DB package helpers:

- `pnpm --filter @pinetree/db prisma:migrate` – creates/applies a dev migration (interactive)
- `pnpm --filter @pinetree/db prisma:studio` – opens Prisma Studio

## Slack bot setup

High-level steps:

1. Create a Slack App.
2. Enable **Event Subscriptions**.
3. Set the Request URL to:

- `${PUBLIC_BASE_URL}/webhook/slack`

1. Under **Subscribe to bot events**, add message events for the surfaces you want to support:

- `message.channels` (public channels)
- `message.groups` (private channels)
- `message.im` (DMs)
- `message.mpim` (group DMs)

1. Under **OAuth & Permissions**, add Bot Token Scopes:

- `chat:write` (to send replies)
- `users:read` (optional; to store real user display names/avatars)

1. Install the app to your workspace.
2. Copy credentials into env:

- `SLACK_SIGNING_SECRET` (from **Basic Information**)
- `SLACK_BOT_TOKEN` (Bot User OAuth Token from **OAuth & Permissions**)

Notes:

- This MVP listens for message events and parses the message text for time-tracking commands.
- Slack menus are sent as Block Kit interactive buttons.
- To store real user display names/avatars, grant the bot token the `users:read` scope.
- Important: in Slack, messages starting with `/` are usually interpreted as **Slash Commands** and may not be delivered as regular message events. Prefer plain text like `Start shift` / `Break start` / `menu`.
- If you really want to use `/start`-style text without implementing Slack Slash Commands, Slack suggests sending it as a message by prefixing a space (e.g. ` /start`).

## User guide (in chat)

- Add the bot to your group/community chat.
- Send `menu` to receive the keyboard (the API may also send it automatically on first interaction).

### Events you can record

Buttons:

- 🟢 Start shift
- ☕ Break start
- ✅ Break end
- 🔴 End shift
- 📝 Status update

Text command equivalents:

- `/start`
- `/break_start`
- `/break_end`
- `/end`
- `/status <text>`

Free-text synonyms are supported for some common phrases (see `packages/core`).

### Status update flow

If you tap **📝 Status update** or send `/status` without text:

1. Bot prompts you to “Send your status text”.
2. Your next message within 2 minutes is stored as a `STATUS` event.
3. If you don’t reply in time, the pending status expires.

## API reference

Base URL (local): `http://localhost:3000`

### Health

`GET /health`

- Response: `200 { "ok": true }`

### Slack webhook

`POST /webhook/slack`

- Purpose: ingest Slack Events API callbacks.
- Auth: Slack request signature verification (`x-slack-signature`, `x-slack-request-timestamp`).
- Content-Type: `application/json`

Requirements:

- Set `SLACK_SIGNING_SECRET` or the endpoint returns `501`.
- The server verifies the signature against the **raw** request body and rejects replays older than ~5 minutes.

Behavior:

- Invalid signature: `401`
- URL verification: `200 { "challenge": "..." }`
- Event callbacks: `200 { ok: true }` (acked immediately; processing happens best-effort)

Replies:

- If `SLACK_BOT_TOKEN` is set, the server will send simple text replies via `chat.postMessage`.
- If `SLACK_BOT_TOKEN` is set and the token has `users:read`, the server will store real Slack display names/avatars (via `users.info`).

Idempotency:

- Slack delivers `event_id`.
- The API stores it as `Event.sourceMessageId` (prefixed with `slack:`).

### Export endpoints

All export endpoints require:

- Header: `x-api-key: <ADMIN_API_KEY>`

Date range query options:

- `?date=YYYY-MM-DD` (single day)
- `?from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive range)

Errors:

- Missing or wrong key: `401`
- Bad date params: `400`

#### CSV export

`GET /export/csv`

- Response: `200 text/csv` with `Content-Disposition: attachment`

#### XLSX export

`GET /export/xlsx`

- Response: `200 application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` with `Content-Disposition: attachment`

## Data model

Implemented via Prisma in `packages/db/prisma/schema.prisma`.

### Entities

- `User`
  - `provider` + `providerUserId` (unique pair)
  - `name`, optional `avatarUrl`
- `Chat`
  - `provider` + `providerChatId` (unique pair)
- `Event`
  - `eventType` (string, e.g. `START_SHIFT`, `BREAK_START`, `BREAK_END`, `END_SHIFT`, `STATUS`)
  - `text` (optional, used for status notes)
  - `sourceMessageId` (unique, for idempotency)
  - `createdAt` (derived from payload timestamp)
  - `rawPayload` (optional JSON string)

### Idempotency model

- We treat `sourceMessageId` as a natural idempotency key.
- Prisma unique constraint prevents duplicates.
- The API catches the “duplicate key” case and returns success.

## Exports

### CSV columns

CSV rows include:

- `Date` (local date in `TIMEZONE`)
- `User`
- `Event type`
- `Time (local)`
- `Notes/status text`

CSV escaping:

- Values containing newline, comma, or quote are quoted.
- Quotes are doubled.

### XLSX format

Workbook contains:

- `Events` sheet: equivalent to CSV rows
- `Daily Summary` sheet: per-user daily totals

Summary logic:

- “Worked minutes” excludes time spent on breaks.
- “Incomplete” is true if a day is missing required start/end data.

## Security

Current MVP security posture:

- Export endpoints are protected by a shared secret (`ADMIN_API_KEY`) via `x-api-key`.
- `POST /webhook/slack` is authenticated via Slack request signatures.

Recommended hardening for production:

- Keep Slack signature verification enabled; also consider replay protections (timestamp window).
- Run behind HTTPS and keep `ADMIN_API_KEY` in a secret store.

## Testing

Test types:

- Unit tests (Vitest): `packages/core`, `packages/exporter`
- API integration tests (Vitest + supertest): `apps/api`

Integration tests use Postgres and isolate themselves by creating a unique schema per test run, then running Prisma migrations for that schema.

To point tests at a specific Postgres instance, set:

- `TEST_DATABASE_URL` (optional)
  - Example: `postgresql://postgres:postgres@127.0.0.1:5433/pinetree?schema=public`

Note:

- The Prisma CLI is invoked from the `packages/db` workspace.
- Turbo is configured so `pnpm test` builds dependencies first (so tests don’t run against stale build output).

## Deployment

This project is intentionally “production-shaped”, but still an MVP. The safest deployment approach is a managed Postgres database (e.g. Railway Postgres) and a reverse proxy providing TLS.

### Production checklist

- Use HTTPS (TLS termination via a reverse proxy).
- Set a strong `ADMIN_API_KEY`.
- Use an IANA `TIMEZONE` that matches your reporting needs.
- Persist the database (use Postgres).
- Apply migrations as part of deploy (`prisma migrate deploy`).
- Ensure `PUBLIC_BASE_URL` points at your public HTTPS domain.

### Deploy with Docker (recommended)

1. Create a `.env` for production (do not commit it):

```env
DATABASE_URL="postgresql://postgres:postgres@postgres:5432/pinetree?schema=public"
ADMIN_API_KEY="replace-with-a-long-random-secret"
TIMEZONE="UTC"
PUBLIC_BASE_URL="https://your-domain.example"
PORT="3000"
```

1. Run the service:

```bash
docker compose up --build -d
```

1. Put a reverse proxy in front of the container.

- Terminate TLS at the proxy and forward requests to the container on port 3000.
- Ensure your proxy allows `POST /webhook/slack` and `GET /export/*`.

1. Verify:

- `GET /health` returns `{ "ok": true }`.

Notes:

- The provided `docker-compose.yml` includes a Postgres service and a persistent named volume.

### Deploy to Railway (Postgres)

Recommended shape:

1. Create a Railway Postgres database.
2. Set Railway environment variables:

- `DATABASE_URL` (from Railway Postgres)
- `ADMIN_API_KEY`
- `TIMEZONE`
- `PUBLIC_BASE_URL` (your Railway service URL)

1. Ensure migrations run during deploy:

```bash
pnpm -C packages/db exec prisma migrate deploy --schema prisma/schema.prisma
```

1. Start the service:

```bash
pnpm --filter @pinetree/api start
```

### Deploy without Docker (systemd)

This is a straightforward Node.js service. You can run it with a process manager (systemd, PM2, etc.). The minimal workflow is:

1. Install dependencies and build:

```bash
pnpm install --frozen-lockfile
pnpm build
```

1. Run migrations (recommended during deploy):

```bash
pnpm -C packages/db exec prisma migrate deploy --schema prisma/schema.prisma
```

1. Start the API:

```bash
pnpm --filter @pinetree/api start
```

Example systemd unit (adjust paths/user/env):

```ini
[Unit]
Description=pinetree API
After=network.target

[Service]
Type=simple
User=pinetree
WorkingDirectory=/srv/pinetree
EnvironmentFile=/srv/pinetree/.env
ExecStart=/usr/bin/pnpm --filter @pinetree/api start
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
```

### Database options

This project is configured for Postgres.

### Backups

- Postgres: use standard Postgres backup tooling (logical dumps or snapshot-based backups).

## Troubleshooting

### Prisma migrate deploy fails in tests

Symptoms:

- `prisma migrate deploy failed with status 254`

Cause:

- Prisma CLI must be run from the `packages/db` workspace (where Prisma is installed).

### ESLint errors about “project service” files not found

Cause:

- Generated artifacts (e.g. `*.d.ts`, `*.js`) accidentally emitted into `src/` or `test/` will confuse ESLint’s TypeScript project service.

Fix:

- Remove the generated files and re-run `pnpm lint`.
- Use `pnpm build` for builds and `pnpm typecheck` for checking; avoid running `tsc` without `--noEmit` against non-build configs.
