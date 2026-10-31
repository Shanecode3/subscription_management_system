# Brightloop Software — Subscription Management System

Unified subscription, recurring billing, invoicing, payment and revenue platform.
Built for **Odoo × Make-A-Ton 9.0**.

**Stack:** local PostgreSQL 18 · Node.js 20 + TypeScript + Express 4 · React 18 + Vite + Tailwind CSS

> No BaaS, no cloud database, no third-party billing API. Every number shown in the UI is read from or written to the local PostgreSQL database.

---

## Prerequisites

- **Node.js 20+** (this build was verified on Node 24)
- **PostgreSQL 18** running on `localhost:5432`
- npm 10+

---

## Setup

### 1. Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

### 2. Configure the server environment

```bash
cd server
cp .env.example .env      # Windows: copy .env.example .env
```

Edit `server/.env` and set `DATABASE_URL` to your real PostgreSQL password:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/brightloop_db
```

The rest of the file already works out of the box. `.env` is git-ignored.

### 3. Create the database, apply the schema, seed accounts

```bash
cd server
npm run db:setup
```

This runs three idempotent steps: `db:create` → `db:init` → `db:seed`. Re-running it is always safe.

### 4. Run both apps

```bash
# terminal 1
cd server && npm run dev        # API  → http://localhost:5000/api/v1

# terminal 2
cd client && npm run dev        # UI   → http://localhost:5173
```

Open <http://localhost:5173>.

---

## Demo accounts

All three seeded accounts share the password **`Brightloop@2026`**. The sign-in screen has one-click buttons that fill them in.

| Role | Email |
| :--- | :--- |
| Admin | `admin@brightloop.com` |
| Staff | `staff@brightloop.com` |
| Customer | `customer@brightloop.com` |

These are local seed accounts for evaluation only.

---

## Server scripts

| Script | What it does |
| :--- | :--- |
| `npm run dev` | Start the API with hot reload (`tsx watch`) |
| `npm run build` | Type-check and compile to `dist/` |
| `npm start` | Run the compiled API |
| `npm run typecheck` | Type-check only |
| `npm run db:create` | Create `brightloop_db` if it does not exist |
| `npm run db:init` | Apply `src/db/schema.sql` (idempotent) |
| `npm run db:seed` | Re-apply the schema, then seed the three demo accounts, the catalogue (products + variants), the plans, the quotation templates and, when none exist yet, two demo subscriptions |
| `npm run db:seed:perf` | Re-apply the schema, then generate the performance dataset (140 customers, 1,050 subscriptions, 2,700 invoices, 1,847 payments), benchmark the dashboard SQL with `EXPLAIN ANALYZE`; add `-- --reset` to rebuild it |
| `npm run db:setup` | All three of the above, in order |

---

## API surface (Milestones 1–6)

Base path: `/api/v1`

| Method | Path | Access |
| :--- | :--- | :--- |
| `GET` | `/health` | Public |
| `POST` | `/auth/signup` | Public — always creates a `CUSTOMER` |
| `POST` | `/auth/login` | Public |
| `POST` | `/auth/forgot-password` | Public |
| `POST` | `/auth/reset-password` | Public (valid single-use token) |
| `GET` | `/auth/me` | Authenticated |
| `POST` | `/admin/users/staff` | **Admin only** |
| `GET` | `/admin/users` | Admin, Staff |
| `GET` | `/products` | Authenticated — customers see active products only |
| `GET` | `/products/:id` | Authenticated |
| `POST` | `/products` | **Admin only** |
| `PATCH` | `/products/:id` | **Admin only** |
| `DELETE` | `/products/:id` | **Admin only** — retires the product, keeps history |
| `POST` | `/products/:id/variants` | **Admin only** — attribute, value, `priceExtra` |
| `DELETE` | `/products/:id/variants/:variantId` | **Admin only** |
| `GET` | `/plans` | Authenticated — customers see active, currently-available plans |
| `GET` | `/plans/:id` | Authenticated |
| `POST` | `/plans` | **Admin only** |
| `PATCH` | `/plans/:id` | **Admin only** — also the single-flag toggle |
| `DELETE` | `/plans/:id` | **Admin only** — retires the plan |
| `GET` | `/quotation-templates` | Admin, Staff |
| `GET` | `/quotation-templates/:id` | Admin, Staff |
| `POST` | `/quotation-templates` | **Admin only** |
| `GET` | `/subscriptions` | Admin, Staff — filter by `status`, `customerId` |
| `GET` | `/subscriptions/:id` | Admin, Staff |
| `POST` | `/subscriptions` | Admin, Staff — from a `templateId`, or `planId` + `lines` |
| `PUT` | `/subscriptions/:id/status` | Admin, Staff — enforced transitions and plan flags |
| `GET` | `/portal/subscriptions` | **Customer only** — filtered to their own contracts |
| `GET` | `/portal/subscriptions/:id` | **Customer only** — 404 for another customer's id |
| `PATCH` | `/portal/subscriptions/:id/addons` | **Customer only** — `{ lineId, isActive }` |
| `POST` | `/portal/subscriptions/:id/pause` | **Customer only** — needs `allow_pause` |
| `POST` | `/portal/subscriptions/:id/resume` | **Customer only** |
| `POST` | `/portal/subscriptions/:id/early-close` | **Customer only** — needs `allow_early_close` |
| `POST` | `/portal/subscriptions/:id/renew` | **Customer only** — needs `allow_renew` |
| `GET` | `/tax-rules` | Authenticated — customers see active rates only |
| `POST` | `/tax-rules` | **Admin only** — one default at a time |
| `PATCH` | `/tax-rules/:id` | **Admin only** |
| `DELETE` | `/tax-rules/:id` | **Admin only** — retires the rate, keeps history |
| `GET` | `/discount-rules` | Admin, Staff |
| `POST` | `/discount-rules` | **Admin only** — staff receives 403 |
| `PATCH` | `/discount-rules/:id` | **Admin only** |
| `DELETE` | `/discount-rules/:id` | **Admin only** — retires the rule and detaches it |
| `GET` | `/invoices` | Authenticated — filter by `status`, `customerId`, `from`, `to`, `limit`; customers see only their own |
| `GET` | `/invoices/overdue` | Authenticated — `Confirmed` invoices past `due_date`, with `daysOverdue` and `balanceDue` |
| `GET` | `/invoices/:id` | Authenticated — 404 for another customer's invoice |
| `POST` | `/invoices/:id/confirm` | Admin, Staff — `Draft → Confirmed` |
| `POST` | `/invoices/:id/send` | Admin, Staff — records `sentAt` |
| `POST` | `/invoices/:id/cancel` | Admin, Staff — `Draft`/`Confirmed → Cancelled`; refused once payments exist |
| `POST` | `/invoices/:id/print` | Admin, Staff — records the print action |
| `GET` | `/payments` | Authenticated — filter by `invoiceId`, `customerId`, `from`, `to`, `limit`; customers see only their own |
| `POST` | `/payments` | Admin, Staff — records a receipt and reconciles the invoice in one transaction |
| `GET` | `/billing/pending` | Admin, Staff — due contracts, totals and auto-closes |
| `POST` | `/billing/run-billing-day` | Admin, Staff — idempotent invoice generation |
| `GET` | `/finance/dashboard` | Admin, Staff — KPI summary; filter by `startDate`, `endDate`, `planId`, `customerId`, `limit` |
| `GET` | `/finance/filter-options` | Admin, Staff — plans and customers that actually have contracts |

Responses use one envelope everywhere:

```json
{ "success": true,  "data": { }, "message": "optional" }
{ "success": false, "error": { "code": "VALIDATION_FAILED", "message": "…", "details": [] } }
```

---

## Layout

```
server/src/
  config/      environment parsing (fails fast on missing values)
  db/          schema.sql, pool, create/init/seed scripts, performance seed
  repositories/  SQL only (products, plans, templates, subscriptions, invoices, payments, tax, discounts, users, finance, audit)
  services/      business rules only (incl. billing engine, invoice actions, payment reconciliation, discount evaluation, finance dashboard)
  middleware/    auth, validation, errors, request logging
  routes/        HTTP surface only
  utils/         errors, validators, JWT, logger, response, money, params, dates
client/src/
  lib/           api client, auth context, types, formatting, navigation, status maps, hooks
  components/    ui primitives, layout, catalog forms, billing forms, subscription stepper
  pages/         auth screens, dashboard, finance dashboard, catalog, subscriptions, billing day, invoices, print, portal
```

Dependency direction is one way: `routes → services → repositories → db`. Services never build SQL, repositories never decide permissions, and routes never contain business rules.

---

## Documentation

- `DEFENSE_LOG.md` — every table, route, middleware module and screen, with design rationale and prepared evaluator Q&A.
- `SPEC.md` — full architecture and schema specification.
- `TODO.md` — milestone roadmap.
