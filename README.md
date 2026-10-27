# Smart Reactive Safety System for Lone Workers

An organization-aware safety monitoring application for lone workers and their IoT devices. The system receives device telemetry, keeps historical readings, shows the latest worker and device state, and opens an incident when a device reports an emergency through `sos: true`.

**This is a self-contained demo build.** There is no database and no Redis to provision: the app seeds a small in-memory dataset at startup and runs on `npm install && npm run dev` with no `.env` file needed. Data resets whenever the process restarts — that's expected for a demo, not a bug.

## Contents

- [Demo accounts](#demo-accounts)
- [Quick start](#quick-start)
- [Features](#features)
- [System overview](#system-overview)
- [Technology stack](#technology-stack)
- [Environment variables](#environment-variables)
- [Google sign-in setup](#google-sign-in-setup)
- [Password-reset email setup](#password-reset-email-setup)
- [Telemetry webhook setup](#telemetry-webhook-setup)
- [Authentication and authorization](#authentication-and-authorization)
- [API overview](#api-overview)
- [Domain model](#domain-model)
- [Project structure](#project-structure)
- [Available commands](#available-commands)
- [Smoke testing](#smoke-testing)
- [Troubleshooting](#troubleshooting)
- [Turning this into a real deployment](#turning-this-into-a-real-deployment)

## Demo accounts

All seeded accounts use the same password: **`Demo@12345`**

| Role | Email | Organization |
| --- | --- | --- |
| `SUPERADMIN` | `superadmin@demo.local` | None (global access) |
| `ADMIN` | `admin.borneo@demo.local` | Borneo Mining Co |
| `ADMIN` | `admin.java@demo.local` | Java Logistics Corp |

Each organization comes with 4 seeded workers, each with its own registered Worker Node and a few hours of telemetry history. Borneo Mining Co has a fresh `ACTIVE` incident (visible immediately on login) and Java Logistics Corp has an already-`RESOLVED` incident, so both incident states are visible without doing anything first.

The seed data and these accounts are defined in [`src/lib/prisma.js`](src/lib/prisma.js) and are rebuilt from scratch every time the server process starts.

## Quick start

```bash
git clone <repository-url>
cd smart-reactive-safety-system
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with any account from [Demo accounts](#demo-accounts). No `.env` file, database, or Redis instance is required — `JWT_SECRET` and `TELEMETRY_WEBHOOK_SECRET` fall back to fixed demo values (see [Environment variables](#environment-variables)) when unset.

## Features

- Organization and license management for `SUPERADMIN` users.
- Organization-scoped administration for `ADMIN` users.
- Worker and Worker Node registration with a one-to-one assignment.
- Device quota enforcement from each organization's license.
- Historical storage of the complete 19-field telemetry payload.
- Latest telemetry, location, dashboard, and worker monitoring views.
- Emergency incident creation from `sos: true` telemetry.
- Manual incident resolution by an authorized administrator.
- Audit logging for important application actions.
- Password login, refresh tokens, Google sign-in, and password reset by OTP.
- Responsive navigation, light/dark themes, maps, charts, and profile settings.
- Soft deletion for business records.

## System overview

### Application flow

```text
Browser
  -> Next.js pages
  -> browser service layer (src/services)
  -> Next.js route handlers (src/app/api)
  -> domain/auth helpers (src/lib)
  -> in-memory store (src/lib/prisma.js)

In-memory TTL map (src/lib/redis.js)
  <- OTP and reset-token state
  <- revoked refresh tokens
  <- telemetry deduplication keys
```

`src/lib/prisma.js` and `src/lib/redis.js` implement the same call shapes the rest of the codebase already uses, so every route handler, service, and business rule works exactly like it would against a real Postgres + Redis setup -- only the storage underneath changed.

### Telemetry flow

```text
Worker Node
  -> POST /api/webhooks/telemetry/{token}
  -> validate the complete payload
  -> resolve WorkerNode by device worker_id
  -> verify device, worker, organization, and license
  -> append a Telemetry record
  -> create or preserve an ACTIVE Incident when sos is true
```

Relay transport does not change ownership. If Node A sends through Node B, `worker_id` must still identify Node A.

### Core ownership model

```text
License 1 <-> 0..1 Organization

Organization
  |-- Users
  |-- Workers
  |     `-- WorkerNode (one-to-one assignment)
  |           `-- Telemetry history
  |-- Incidents
  `-- AuditLogs
```

## Technology stack

| Area | Technology |
| --- | --- |
| Full-stack framework | Next.js App Router |
| UI | React 19, Tailwind CSS 4, Lucide React |
| Forms | Formik and Yup |
| Browser HTTP client | Axios |
| Maps | Leaflet and React Leaflet |
| Data store | In-memory, seeded at startup (`src/lib/prisma.js`, `src/lib/redis.js`) |
| Authentication | HMAC-signed access/refresh tokens and Google Identity Services |
| Email | Nodemailer over SMTP, with a development log driver (default) |
| Language | JavaScript |

Exact package versions are pinned in [`package.json`](package.json) and [`package-lock.json`](package-lock.json).

## Environment variables

Nothing is required for the demo to run. Start with [`.env.example`](.env.example) if you want to override any default; copy it to `.env.local`. Server secrets must never use the `NEXT_PUBLIC_` prefix.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `JWT_SECRET` | No | fixed demo value | HMAC secret for access and refresh tokens. Set your own if sharing this build beyond a local demo. |
| `ACCESS_TOKEN_TTL_SECONDS` | No | `900` | Access-token lifetime. |
| `REFRESH_TOKEN_TTL_SECONDS` | No | `2592000` | Refresh-token lifetime. |
| `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | For Google login | Empty | Leave empty to disable Google sign-in. |
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:3000/api` | Browser-side Axios base URL, embedded during build. |
| `BUSINESS_TIME_ZONE` | No | `Asia/Jakarta` | IANA zone used for license calendar dates. |
| `OTP_EXPIRY_MINUTES` / `OTP_RESEND_COOLDOWN_SECONDS` / `OTP_MAX_ATTEMPTS` / `RESET_TOKEN_TTL_SECONDS` | No | see `.env.example` | Password-reset OTP tuning. |
| `MAIL_DRIVER` | No | `log` | `smtp` sends real email; any other value logs the OTP to the console. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `MAIL_FROM` | For SMTP | Empty | Only used when `MAIL_DRIVER=smtp`. |
| `TELEMETRY_WEBHOOK_SECRET` | No | fixed demo value | Shared secret in the webhook path. |
| `TELEMETRY_WEBHOOK_MAX_BATCH` / `TELEMETRY_DEDUPE_TTL_SECONDS` | No | see `.env.example` | Webhook ingestion tuning. |

## Google sign-in setup

The browser uses Google Identity Services and sends its ID token to the server for verification. The current flow does not use a redirect/callback route.

1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create/select a project and configure the OAuth consent screen.
3. Add test users if the consent screen is still in testing mode.
4. Go to **APIs & Services -> Credentials**.
5. Choose **Create credentials -> OAuth client ID -> Web application**.
6. Add `http://localhost:3000` as an **Authorized JavaScript origin**.
7. No authorized redirect URI is required for the current button flow.
8. Put the same client ID in both variables:

```dotenv
GOOGLE_CLIENT_ID=123456789-example.apps.googleusercontent.com
NEXT_PUBLIC_GOOGLE_CLIENT_ID=123456789-example.apps.googleusercontent.com
```

Restart development after editing the env file; rebuild production because public variables are embedded at build time.

Account behavior:

- A verified Google email matching an existing active user signs into that account with its current role/organization.
- A new email creates a passwordless `PENDING` account with no permissions. A `SUPERADMIN` must assign `SUPERADMIN`, or `ADMIN` plus an organization.
- A deactivated matching account is rejected.
- The first successful Google login records `googleLinkedAt`.

Leave both client ID variables empty to disable Google login (the default). The button is hidden and `POST /api/auth/google` returns `503`.

## Password-reset email setup

The flow is: request OTP -> verify OTP -> use one-time token to set a new password.

By default (`MAIL_DRIVER=log`) the server prints the OTP to its own console instead of sending an email:

```text
[mail:log] Password reset OTP for user@example.com: 123456 (valid 15 min)
```

To send real email, set `MAIL_DRIVER=smtp` and the `SMTP_*` variables.

The forgot-password endpoint intentionally returns a generic response regardless of whether the email exists, reducing account enumeration risk.

## Telemetry webhook setup

### Endpoint

```text
POST /api/webhooks/telemetry/{TELEMETRY_WEBHOOK_SECRET}
```

With the demo default secret:

```text
http://localhost:3000/api/webhooks/telemetry/demo-webhook-secret-change-me
```

No authorization header is required. The secret is in the path because the current firmware builds the target from a host and token.

`worker_id` must match a non-deleted Worker Node's numeric `deviceWorkerId` (the seeded nodes use `1001`-`1004` for Borneo Mining Co and `2001`-`2004` for Java Logistics Corp). Unknown devices are rejected, never auto-registered.

### Required 19-field payload

| Code | JSON field | Type/range |
| --- | --- | --- |
| V01 | `sequence` | Float |
| V02 | `accel_y` | Float |
| V03 | `longitude` | Decimal, -180 to 180 |
| V04 | `timestamp` | Float |
| V05 | `temperature` | Float |
| V06 | `sos` | Boolean |
| V07 | `gyro_z` | Float |
| V08 | `latitude` | Decimal, -90 to 90 |
| V09 | `satellites` | Float |
| V10 | `altitude` | Float |
| V11 | `battery_percent` | Float |
| V12 | `humidity` | Float |
| V13 | `worker_id` | Float; resolves `WorkerNode.deviceWorkerId` |
| V14 | `gyro_x` | Float |
| V15 | `pressure` | Float |
| V16 | `battery_voltage` | Float |
| V17 | `accel_x` | Float |
| V18 | `accel_z` | Float |
| V19 | `gyro_y` | Float |

All fields are required. Numbers must be JSON numbers, not strings, and `sos` must be a JSON boolean.

```json
{
  "sequence": 1,
  "accel_y": 0.02,
  "longitude": 116.80513,
  "timestamp": 1727769600,
  "temperature": 29.5,
  "sos": false,
  "gyro_z": 0.1,
  "latitude": -1.20462,
  "satellites": 8,
  "altitude": 12.4,
  "battery_percent": 94,
  "humidity": 71,
  "worker_id": 1001,
  "gyro_x": 0.02,
  "pressure": 1008.2,
  "battery_voltage": 4.08,
  "accel_x": 0.01,
  "accel_z": 0.98,
  "gyro_y": 0.04
}
```

Send a single reading against the seeded demo data:

```bash
curl -X POST "http://localhost:3000/api/webhooks/telemetry/demo-webhook-secret-change-me" \
  -H "Content-Type: application/json" \
  --data-binary '{"sequence":1,"accel_y":0.02,"longitude":116.80513,"timestamp":1727769600,"temperature":29.5,"sos":false,"gyro_z":0.1,"latitude":-1.20462,"satellites":8,"altitude":12.4,"battery_percent":94,"humidity":71,"worker_id":1001,"gyro_x":0.02,"pressure":1008.2,"battery_voltage":4.08,"accel_x":0.01,"accel_z":0.98,"gyro_y":0.04}'
```

The endpoint accepts a single telemetry object, an array of them, `{ "data": [...] }`, or `{ "type": "telemetry", "data": {...}, "metadata": {} }`. Batch responses report received, accepted, duplicate, and rejected items.

### Deduplication and incidents

The tuple `worker_id + sequence + timestamp` is deduplicated in-memory for `TELEMETRY_DEDUPE_TTL_SECONDS`. When `sos` is `true`, telemetry is stored and a new `ACTIVE` incident is created only if the Worker Node has none; repeated emergency readings preserve the same active incident. An owning `ADMIN` or any `SUPERADMIN` must resolve it explicitly.

## Authentication and authorization

### Token flow

- Password/Google login returns an access token and refresh token.
- The frontend stores them in `localStorage`; Axios sends `Authorization: Bearer <access-token>`.
- On expiry, the client attempts one refresh and retries the request.
- Logout revokes the refresh token.
- Password/account changes can invalidate issued tokens through `tokenVersion`.

### Roles

| Role | Access |
| --- | --- |
| `SUPERADMIN` | Global licenses, organizations, users, workers, devices, telemetry, incidents, and audit data; can act in an organization context. |
| `ADMIN` | Assigned organization only; manages workers/devices, reads monitoring/telemetry/audit data, and resolves its incidents. |
| `PENDING` | No permissions; temporary state for a new Google-authenticated account. |

A Worker is a monitored person, not an application login role.

## API overview

The browser uses `/api`. The static OpenAPI document is available at [http://localhost:3000/openapi.json](http://localhost:3000/openapi.json) while running.

| Capability | Routes |
| --- | --- |
| Authentication | `/api/auth/login`, `/google`, `/refresh`, `/logout`, `/me`, `/change-password`, `/forgot-password`, `/verify-otp`, `/reset-password` |
| Organization context | `/api/auth/switch-organization` |
| Licenses | `/api/licenses`, `/api/licenses/{id}`, options and delete-preview |
| Organizations | `/api/organizations`, `/api/organizations/{id}`, options and delete-preview |
| Users | `/api/users`, `/api/users/{id}` |
| Workers | `/api/workers`, `/api/workers/{id}`, options and delete-preview |
| Worker Nodes | `/api/worker-nodes`, `/api/worker-nodes/{id}`, delete-preview |
| Telemetry | `/api/telemetry`, `/api/telemetry/latest` |
| Device ingestion | `/api/webhooks/telemetry/{token}` |
| Monitoring | `/api/monitoring`, `/api/monitoring/{workerId}`, `/api/dashboard/summary` |
| Incidents | `/api/incidents`, `/api/incidents/{id}`, `/api/incidents/{id}/resolve` |
| Audit | `/api/audit-logs` |

## Domain model

[`prisma/schema.prisma`](prisma/schema.prisma) is the canonical reference for entities, fields, relations, and unique constraints -- it documents the data model even though the app no longer runs a real Postgres database.

| Model | Purpose |
| --- | --- |
| `License` | Valid calendar period and device limit. |
| `Organization` | Tenant boundary for admins, workers, devices, incidents, and logs. |
| `User` | `SUPERADMIN`, `ADMIN`, or transitional `PENDING` account. |
| `Worker` | Human worker with a globally unique worker code. |
| `WorkerNode` | Physical device identified by `deviceWorkerId`, assigned one-to-one to a Worker. |
| `Telemetry` | Append-oriented device history with server `receivedAt`. |
| `Incident` | Emergency record with `ACTIVE` or `RESOLVED` status. |
| `AuditLog` | Important action and metadata. |

Entity IDs are UUIDs. Business tables use `is_deleted` soft deletion. [`src/lib/prisma.js`](src/lib/prisma.js) mirrors this model as plain JavaScript objects in `Map`s, seeded once per process start.

## Project structure

```text
.
|-- .env.example                # Environment template (all optional for the demo)
|-- package.json                # npm scripts and dependencies
|-- next.config.mjs             # Next.js/React Compiler configuration
|-- postcss.config.mjs          # Tailwind CSS PostCSS plugin
|-- jsconfig.json               # @/* -> ./src/* alias
|-- prisma/
|   `-- schema.prisma           # Domain model reference (documentation only)
|-- public/
|   |-- openapi.json            # API contract
|   |-- sounds/                 # Emergency alarm asset
|   `-- uploads/                # Runtime avatars; ignored by Git
|-- scripts/                    # Smoke-test scripts
|-- src/
|   |-- app/
|   |   |-- (auth)/             # Login/password-reset pages
|   |   |-- (main)/             # Authenticated pages/layout
|   |   |-- api/                # Next.js route handlers
|   |   |-- globals.css         # Tailwind, theme tokens, global styles
|   |   |-- layout.js           # Root layout
|   |   `-- page.js             # Root entry/redirect
|   |-- components/
|   |   |-- atoms/              # Small reusable controls
|   |   |-- organisms/          # Tables, navigation, maps, panels
|   |   |-- telemetry/          # Charts, gauges, telemetry maps
|   |   `-- template/           # Feature-specific composed UI
|   |-- lib/                    # Auth, domain, validation, in-memory persistence
|   `-- services/               # Browser API service modules
`-- tests/                      # Existing automated checks
```

Conventions:

- Pages call application APIs through `src/services`.
- API route handlers live in `src/app/api`.
- Server authorization and organization scoping are authoritative.
- Theme variables live in `src/app/globals.css`; dark mode uses `data-theme="dark"`.
- `@/` resolves to `src/`.
- Avatars are written to `public/uploads/avatars` and are not committed.

## Available commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start development. |
| `npm run build` | Create a production build. |
| `npm run start` | Run a completed production build. |
| `npm run lint` | Run ESLint. |
| `npm run test` | Run the existing checks under `tests/`. |
| `npm run test:smoke:demo` | Zero-setup smoke test against the seeded demo accounts (see below). |
| `npm run test:smoke` | Full regression smoke test; needs a Redis container and several env vars -- see the comment at the top of `scripts/smoke-test.mjs`. Written for the earlier real-infrastructure setup. |

## Smoke testing

Start the server (`npm run dev`), then in another terminal:

```bash
npm run test:smoke:demo
```

This logs in as the `SUPERADMIN` and each seeded `ADMIN`, hits one protected endpoint per role, and checks organization isolation and that the seeded `ACTIVE`/`RESOLVED` incidents exist. It needs no environment variables and no external services -- if a future change breaks the seed or auth wiring, this fails loudly instead of silently.

## Troubleshooting

### Login fails with the documented demo credentials

Make sure the server process was actually restarted after a code change -- the in-memory store (and its seed data) resets on every process start, so stale tokens from a previous run are invalid.

### Google login fails

Leave `GOOGLE_CLIENT_ID` empty to disable the feature entirely (`POST /api/auth/google` returns `503`). To enable it, confirm both client ID variables match, the origin is authorized, and the server was restarted.

### Password-reset email does not arrive

`MAIL_DRIVER=log` (the default) prints the OTP to the server console instead of sending an email -- check the terminal running `npm run dev`.

### Telemetry errors

- `401 WEBHOOK_UNAUTHORIZED`: wrong secret in the path; the default is `demo-webhook-secret-change-me` unless `TELEMETRY_WEBHOOK_SECRET` is set.
- `404 DEVICE_NOT_REGISTERED`: register a node whose `deviceWorkerId` equals payload `worker_id`, or use one of the seeded ids (`1001`-`1004`, `2001`-`2004`).
- Duplicate result: the same `worker_id`, `sequence`, and `timestamp` was already received within the dedupe TTL.

### Build runs out of memory on Windows

```powershell
$env:NODE_OPTIONS='--max-old-space-size=2048'
npm run build
Remove-Item Env:NODE_OPTIONS
```

## Turning this into a real deployment

This build intentionally trades persistence for zero setup: `src/lib/prisma.js` and `src/lib/redis.js` hold everything in process memory, and all data is lost on restart. To run this for real:

1. Reintroduce a real database behind `src/lib/prisma.js`'s exported shape (Prisma + Postgres is a natural fit given `prisma/schema.prisma`) and a real cache/store behind `src/lib/redis.js`'s exported shape (`get`/`setEx`/`setNxEx`/`del`/`ttl`/`getDel`/`evalScript`/`multiSetEx`). No other file needs to change -- every route handler already goes through those two modules.
2. Set a real `JWT_SECRET` and `TELEMETRY_WEBHOOK_SECRET` (the fixed demo values in `src/lib/config.js` are not safe beyond a local demo).
3. Replace the seed step with deliberate provisioning of the first `SUPERADMIN` account, rather than relying on module-load-time seeding.
4. Put the application behind HTTPS, configure backups/monitoring for the real stores, and review [`src/app/api`](src/app/api) for anything that assumed a single-process deployment (e.g. the advisory-lock no-ops in `telemetryIngest.js` and `worker-nodes/route.js`, which relied on Node's single-threaded event loop and need a real lock under multiple instances).
