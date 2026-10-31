# Brightloop — Subscription & Recurring Billing Platform

A complete subscription management system for a fictional software house, **Brightloop Software**: products and variants, subscription plans, quotation templates, a contract lifecycle, automated recurring invoicing, admin-configured discounts and taxes, payment recording, a customer self-service portal and a finance dashboard.

**Stack:** PostgreSQL 18 · Node.js + TypeScript + Express 4 · React 18 + Vite + Tailwind CSS

> Everything runs locally. There is no BaaS, no cloud database and no third-party billing, tax or payment API — every figure on screen is read from or written to the local PostgreSQL database, and every rule (subscriptions, taxes, discounts, invoicing, reporting) is implemented in this repository.

**Built for Odoo × Make-A-Ton 9.0.**

---

## Contents

- [Screens and roles](#screens-and-roles)
- [Feature tour](#feature-tour)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Demo accounts](#demo-accounts)
- [Datasets and scripts](#datasets-and-scripts)
- [Architecture](#architecture)
- [Data model](#data-model)
- [How the hard parts work](#how-the-hard-parts-work)
- [API](#api)
- [Performance](#performance)
- [Validation, errors and security](#validation-errors-and-security)
- [Verification performed](#verification-performed)
- [Known limits](#known-limits)
- [Documentation](#documentation)

---

## Screens and roles

Three roles, each with its own navigation. The same `NAV_ITEMS` list drives both the sidebar and the route guards, so a screen can never appear in the navigation without also being protected.

| Screen | Route | Admin | Staff | Customer |
| :--- | :--- | :---: | :---: | :---: |
| Dashboard | `/` | ✅ | ✅ | ✅ (their own view) |
| Finance dashboard | `/finance` | ✅ | ✅ | — |
| Products & variants | `/products` | ✅ edit | ✅ view | ✅ view (no cost prices) |
| Plans | `/plans` | ✅ edit | ✅ view | ✅ view (on-sale plans) |
| Quotation templates | `/templates` | ✅ | ✅ | — |
| Subscriptions | `/subscriptions` | ✅ | ✅ | — |
| Billing day | `/billing` | ✅ | ✅ | — |
| Invoices / invoice detail / print | `/invoices` | ✅ | ✅ | ✅ (own only) |
| Discount rules | `/discounts` | ✅ create/edit | ✅ view | — |
| Tax rules | `/tax-rules` | ✅ | ✅ | — |
| Customer portal | `/portal` | — | — | ✅ |

Sign-up, sign-in, forgot-password and reset-password are public screens. Anything else requires a session; an unknown route shows a 404 page rather than a blank screen.

## Feature tour

### 1. Accounts, authentication and role-based access

- **Self sign-up** always creates a `CUSTOMER`. Emails are unique case-insensitively (`UNIQUE INDEX ON LOWER(email)`), and a duplicate registration returns a specific field error.
- **Password policy** is enforced on the client and again on the server: **9+ characters** with at least one uppercase letter, one lowercase letter and one special character.
- **Forgot password** issues a single-use, time-limited reset token (1 hour). There is no mail server in a local build, so a loopback caller receives the link directly; any other caller gets the same neutral message whether or not the address exists.
- **Only an Admin can add internal staff** (`POST /admin/users/staff`), and **only an Admin can create discount rules** — Staff receives `403`.
- Passwords are stored as bcrypt hashes; sessions are signed JWTs. Every request is authorised by role *and* by tenant: a customer asking for someone else's invoice or contract gets a `404`, not a `403`, so the API never confirms that another customer's record exists.

### 2. Products, variants and plans

- Products carry a `type` (`Software`, `Service`, `Add-on`), `sales_price`, `cost_price` and `notes`. **Cost prices are hidden from customer sessions on the server**, not just in the UI.
- Products support **variants** (attribute + value + `price_extra`), e.g. an *Odoo* brand variant adding **+560** to the base price. Variants referenced by a template, subscription or invoice cannot be deleted — the API returns a `409` and suggests retiring the product instead.
- **Plans** define `price`, `billing_interval` (`daily` / `weekly` / `monthly` / `yearly`), `min_quantity`, an availability window and four lifecycle flags: `auto_close`, `allow_early_close`, `allow_pause`, `allow_renew`.
- A plan with live contracts cannot change its billing interval (that would silently retime every existing subscription), and products/plans are **retired rather than destroyed**, so history stays intact.
- **Quotation templates** pre-select a plan, a validity window and product lines (with variants and quantities) to pre-fill a new subscription in one click.

### 3. From quotation to subscription

A subscription is built either from a template or by hand from a plan and priced lines. Each gets a unique number (`SUB-2026-0001`) and moves through an enforced state machine:

```
Draft ──▶ Quotation ──▶ Confirmed ──▶ Active ──▶ Closed
                            │            │  ▲
                            └──▶ Paused ─┘  └── resume
```

- Illegal moves are rejected with a message that names the state, e.g. resuming a `Closed` contract tells you to renew it instead.
- Plan flags gate the exits: early close needs `allow_early_close`, pause needs `allow_pause`, renewal needs `allow_renew`, and `auto_close` contracts end on their expiry date during the next billing run.
- The customer sees a status stepper, so the whole progression is visible on one screen.

### 4. Billing day and automated invoicing

- One click generates every due invoice for `Active` contracts whose `next_billing_date <= today`, copying customer details, product lines, taxes and the best applicable discount.
- **Zero double-billing:** each invoice carries `billing_cycle_key = sub_<id>_<cycle date>` with a `UNIQUE` constraint. A repeated run, two staff clicking at once, or a renewed contract landing on an already-billed date cannot produce a duplicate — the database enforces it, not the application.
- The same run first closes contracts whose expiry has passed (respecting `auto_close`), so expired contracts stop billing without a scheduler process.
- A **preview** shows exactly what the run will do — how many invoices, how much tax, which contracts will auto-close — before anything is written.
- Invoices move `Draft → Confirmed → Paid`, or to `Cancelled` (refused once any payment exists). Staff can **confirm, send, print and cancel**, and the print view is a clean, self-contained layout.

### 5. Discounts and taxes

- **Admin-only discount rules** support fixed or percentage amounts, with `min_purchase_amount`, `min_quantity`, `start_date`, `end_date` and `max_uses`; scope is either the whole subscription or specific products.
- The billing engine ranks the applicable rules per contract and applies the best one automatically, records which rule was used on the invoice line, and increments a usage counter inside the same transaction. A rule stops applying on its own once it expires or its usage cap is reached.
- **Tax rules** are Admin-configured rates with one default at a time (enforced by a partial unique index). The billing engine resolves a rate per contract and snapshots the rate and tax amount onto every invoice line, so a later rate change never rewrites history.

### 6. Payments and the finance dashboard

- Payments are recorded against an invoice with method (`Bank Transfer`, `Credit Card`, `UPI`, `Cash`), amount, date and note. The invoice's paid amount, status and balance are recalculated **in one transaction**, and overpayment is rejected.
- The **Finance Lead dashboard** is one screen: MRR/ARR, active subscriptions, collected revenue, total payments, outstanding balance, overdue invoices, a collections chase list, a monthly cash-flow chart and a contract-portfolio split — all with filters for date range, plan and customer.
- Every figure is a PostgreSQL `SUM`/`COUNT`/`FILTER` aggregate; nothing is summed in JavaScript from a capped list. The monthly chart window follows the selected date range, so the chart and the KPI cards above it always describe the same period.
- Overdue means exactly one thing everywhere: a **Confirmed** invoice whose due date has passed and whose balance is still positive.

### 7. Customer portal

- `/portal` shows **only the signed-in customer's contracts**, filtered on the server.
- Customers can switch **add-ons** on and off on an active contract, **pause**, **resume**, **close early** and **renew** — each action only where the plan allows it. A quotation they have not answered can be accepted or declined.
- When an action is not available, the portal explains why instead of showing a button that leads nowhere.

## Tech stack

| Layer | Choice | Why |
| :--- | :--- | :--- |
| Database | **PostgreSQL 18** | Relational, transactional, `NUMERIC` money, partial and composite indexes, `FILTER` aggregates |
| API | **Node.js + TypeScript + Express 4** | Small surface, explicit layering, no ORM magic |
| Validation | **Zod 3** | One schema per payload, reused field-level messages |
| Auth | **jsonwebtoken + bcryptjs** | Stateless sessions, hashed passwords |
| UI | **React 18 + Vite 5 + TypeScript** | Fast dev loop, typed props |
| Styling | **Tailwind CSS 3.4** | One design system, no runtime CSS-in-JS |
| Icons | **lucide-react** | Consistent 16/20 px line icons |
| Charts | **Hand-built SVG** | No chart library, no third-party data path |

## Quick start

### Prerequisites

- Node.js 20+ (verified on Node 24)
- PostgreSQL 18 running on `localhost:5432`
- npm 10+

### 1 — Install

```bash
cd server && npm install
cd ../client && npm install
```

### 2 — Configure

```bash
cd server
cp .env.example .env        # Windows: copy .env.example .env
```

Set `DATABASE_URL` in `server/.env` to your PostgreSQL connection string:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/brightloop_db
```

Everything else in the file already works. `.env` is git-ignored and is never committed.

### 3 — Create the database and load data

```bash
cd server
npm run db:setup            # create the database, apply the schema, seed accounts + catalogue
npm run db:demo             # optional: replace the data with the demo dataset (recommended)
```

Both steps are idempotent — re-running them is safe.

### 4 — Run

```bash
# terminal 1
cd server && npm run dev    # API → http://localhost:5000/api/v1

# terminal 2
cd client && npm run dev    # UI  → http://localhost:5173
```

Open <http://localhost:5173>. `GET /api/v1/health` reports API and database status.

## Demo accounts

All seeded accounts share the password **`Brightloop@2026`**. The sign-in screen has one-click buttons that fill them in.

| Role | Email |
| :--- | :--- |
| Admin | `admin@brightloop.com` |
| Staff | `staff@brightloop.com` |
| Customer | `customer@brightloop.com` |

The demo dataset adds customer accounts (`vikram.rao@raologistics.example`, `meera.iyer@iyeranalytics.example`, `kabir.khan@khanandco.example`) with their own contracts, invoices and receipts.

> These are local seed credentials for evaluation only. They must be removed before any real deployment.

## Datasets and scripts

### Server (`cd server`)

| Script | What it does |
| :--- | :--- |
| `npm run dev` | Start the API with hot reload (`tsx watch`) |
| `npm run build` | Type-check and compile to `dist/` |
| `npm start` | Run the compiled API |
| `npm run typecheck` | Type-check only |
| `npm run db:create` | Create `brightloop_db` if it does not exist |
| `npm run db:init` | Apply `src/db/schema.sql` (idempotent) |
| `npm run db:seed` | Schema, then accounts, catalogue, plans and templates |
| `npm run db:demo` | Schema, then the walkthrough dataset: 4 customers, 9 contracts across **every** lifecycle state, 16 invoices, 13 payments, one genuine overdue balance and one contract due for a live Billing Day run |
| `npm run db:seed:perf` | Schema, then the performance dataset: 140 customers, 1,050 subscriptions, 2,700 invoices, 1,847 payments, then `EXPLAIN ANALYZE` benchmarks |
| `npm run db:setup` | `db:create` → `db:init` → `db:seed` |

### Client (`cd client`)

| Script | What it does |
| :--- | :--- |
| `npm run dev` | Vite dev server on port 5173, proxying `/api` to the API |
| `npm run build` | Type-check and produce a production bundle |
| `npm run preview` | Serve the production bundle |
| `npm run typecheck` | `tsc --noEmit` |

## Architecture

Dependency direction is one way, and each layer has exactly one job:

```
routes  →  services  →  repositories  →  db
HTTP       business      SQL             pool + schema
```

- **Routes** parse the request, apply `authenticate` and `requireRole`, validate the body with Zod and call a service. No SQL, no business rules.
- **Services** own the rules: state transitions, plan flags, discount ranking, tax resolution, payment reconciliation, tenant scoping. They throw typed errors (`ValidationError`, `ConflictError`, `ForbiddenError`, `NotFoundError`) that the error middleware turns into the API envelope.
- **Repositories** own SQL and nothing else. Multi-step writes take a `PoolClient` so they run in one transaction.
- **`db/`** holds the pool (including a `DATE` → `'YYYY-MM-DD'` parser), the schema and the seeders.

```
server/src/
  config/        environment parsing — fails fast on a missing value
  db/            schema.sql, pool, create/init, seed, seed_demo, seed_performance
  middleware/    auth (JWT + roles), Zod validation, error mapping, request logging
  repositories/  SQL only, one module per aggregate
  routes/        HTTP surface only
  services/      business rules only (incl. the billing engine)
  utils/         errors, validators, money, dates, JWT, logger, response, params

client/src/
  lib/           API client, auth context, types, formatting, navigation, status maps
  components/    UI primitives, layout, catalogue forms, billing forms, charts
  pages/         auth screens, dashboard, finance, catalogue, subscriptions,
                 billing day, invoices, print view, customer portal
```

Every response uses one envelope:

```json
{ "success": true,  "data": {}, "message": "optional" }
{ "success": false, "error": { "code": "VALIDATION_FAILED", "message": "...", "details": [{ "field": "email", "message": "..." }] } }
```

## Data model

Fourteen tables, normalised, with foreign keys, check constraints, unique keys and indexes that match the queries actually used.

| Table | Purpose | Key constraints |
| :--- | :--- | :--- |
| `users` | Accounts and roles | `UNIQUE(email)`, `UNIQUE INDEX ON LOWER(email)`, role `CHECK`, reset-token pair `CHECK` |
| `products` | Catalogue items | unique name, `CHECK` on type and non-negative prices, partial index on active products by type |
| `product_variants` | Attribute/value/price extra per product | `UNIQUE(product_id, attribute_name, attribute_value)` |
| `subscription_plans` | Price, interval, availability, lifecycle flags | unique name, interval `CHECK`, availability-window `CHECK` |
| `quotation_templates` | Reusable offers | unique name, `validity_days > 0` |
| `quotation_template_lines` | Pre-selected product lines | `quantity > 0`, `unit_price >= 0` |
| `tax_rules` | Admin-configured rates | `rate BETWEEN 0 AND 100`, partial unique index for a single default |
| `discount_rules` | Admin-configured promotions | `discount_value > 0`, percentage `CHECK`, `current_uses <= max_uses`, date `CHECK`, scope/target `CHECK` |
| `subscriptions` | The contract | unique `subscription_number`, status `CHECK`, `expiry_date >= start_date`, indexes for due billing, customer/status and plan |
| `subscription_lines` | What the contract sells | `quantity > 0`, non-negative money columns, `ON DELETE SET NULL` to product and variant |
| `invoices` | Billed periods | unique `invoice_number`, **`UNIQUE(billing_cycle_key)`**, invoice/issue `CHECK`, `amount_paid <= total_amount`, indexes for status/due and customer/status |
| `invoice_lines` | Snapshotted invoice rows | non-negative money columns, tax rate snapshot, indexed by invoice |
| `payments` | Receipts | unique `payment_number`, amount `> 0`, indexed by date, invoice and customer |
| `audit_logs` | Who changed what, when | written by every mutating service inside its transaction |

All money is `NUMERIC(12,2)`; all dates are `DATE` handled as `'YYYY-MM-DD'` text so no timezone can shift a billing day.

## How the hard parts work

**State machine.** `TRANSITIONS` in `subscription.service.ts` is the single source of truth for legal moves. `applyTransition` validates the move, the plan flags and the dates, writes the row in a transaction and records an audit event. The client renders only the transitions the server says are allowed (`allowedTransitions` in the DTO), so the UI and the database cannot disagree.

**Billing idempotency.** `runBillingDay` runs three phases in order: close expired `auto_close` contracts, list due contracts, then bill each one. Each invoice is keyed `sub_<id>_<cycle date>`; the `UNIQUE` constraint makes a second attempt a no-op instead of a duplicate. After billing, the contract's `next_billing_date` advances by its interval, and a contract whose next period would fall after its expiry is closed instead of billed again.

**Money.** All arithmetic is done on integer cents and written back as `NUMERIC`, so a 10% discount on ₹1,999.99 lands on the same figure every time. Tax is computed per line from the resolved rate and snapshotted.

**Discounts.** Rules are filtered by scope, dates, usage cap and thresholds, then ranked per contract; the winner is applied, its use is claimed and the line records which rule produced the reduction. Nothing is applied by hand.

**Payments.** A receipt is inserted and the invoice is reconciled (`amount_paid`, status `Paid` when fully settled) in one transaction, with a `CHECK` constraint as the final guard against overpayment.

**Finance aggregates.** One repository builds the dashboard from `SUM`/`COUNT`/`FILTER` queries over indexed columns. The date filter narrows the flow figures (invoiced, collected, outstanding on invoices issued in the window) while MRR and active-subscription counts stay a snapshot of contracts in force today.

## API

Base path `/api/v1`. Every route below is authenticated unless marked public.

| Area | Routes |
| :--- | :--- |
| Health | `GET /health` (public) |
| Auth | `POST /auth/signup`, `/auth/login`, `/auth/forgot-password`, `/auth/reset-password` (public); `GET /auth/me` |
| Staff | `POST /admin/users/staff` (**Admin**), `GET /admin/users` (Admin, Staff) |
| Products | `GET /products`, `GET /products/:id`; `POST`, `PATCH`, `DELETE /products/:id` (**Admin**); `POST /products/:id/variants`, `DELETE /products/:id/variants/:variantId` (**Admin**) |
| Plans | `GET /plans`, `GET /plans/:id`; `POST`, `PATCH`, `DELETE` (**Admin**) |
| Templates | `GET /quotation-templates`, `GET /quotation-templates/:id`; `POST` (**Admin**) |
| Subscriptions | `GET /subscriptions` (status, customerId filters), `GET /subscriptions/:id`, `POST /subscriptions`, `PUT /subscriptions/:id/status` (Admin, Staff) |
| Portal | `GET /portal/subscriptions`, `GET /portal/subscriptions/:id`, `PATCH …/addons`, `POST …/pause`, `…/resume`, `…/early-close`, `…/renew` (**Customer**, own contracts only) |
| Tax rules | `GET /tax-rules`; `POST`, `PATCH`, `DELETE` (**Admin**) |
| Discounts | `GET /discount-rules` (Admin, Staff); `POST`, `PATCH`, `DELETE` (**Admin**) |
| Invoices | `GET /invoices` (status, customerId, from, to, limit), `GET /invoices/overdue`, `GET /invoices/:id`; `POST /invoices/:id/confirm`, `/send`, `/cancel`, `/print` (Admin, Staff) |
| Payments | `GET /payments`, `POST /payments` (Admin, Staff) |
| Billing | `GET /billing/pending`, `POST /billing/run-billing-day` (Admin, Staff) |
| Finance | `GET /finance/dashboard` (startDate, endDate, planId, customerId), `GET /finance/filter-options` (Admin, Staff) |
| Dashboard | `GET /dashboard/summary` — every card on the home screen in one call (Admin, Staff) |

Customers only ever receive their own commercial rows: the subscription, invoice and payment lists filter by the session's customer id, and single-record endpoints return `404` for anyone else's id.

## Performance

The grading target is **under 2 seconds on every page**. Two things make that true by construction: every list is bounded and indexed on the column it filters/sorts by, and every aggregate is computed in PostgreSQL rather than in a JavaScript loop over a fetched list.

Measured on a local machine with the performance dataset loaded (**140 customers, 1,050 subscriptions, 2,700 invoices, 1,847 payments**):

| Surface | Result |
| :--- | :--- |
| Finance dashboard aggregates (all KPIs, chart, chase list) | well under 100 ms at the SQL layer |
| Any screen, full navigation to rendered content | **≈ 570–670 ms**, no page over 700 ms |

`npm run db:seed:perf` regenerates that dataset and prints `EXPLAIN ANALYZE` timings for the dashboard queries, so the claim can be reproduced rather than taken on trust. Indexes that carry the load: `idx_subs_active_billing` (due contracts), `idx_invoices_status_due` (overdue and outstanding), `idx_invoices_customer_status`, `idx_payments_invoice_id`, and the partial unique indexes on tax defaults and active catalogue rows.

## Validation, errors and security

- **Every input is validated twice** — Zod on the client for instant field messages and the same rules on the server for trust. Errors name the field and say what to fix (`"Password must be at least 9 characters long"`, `"A plan named 'Growth' already exists"`, `"Only an Admin can create discount rules"`).
- **Database constraints back the API**: unique keys for emails, plan/product/template names, contract and invoice numbers and the billing cycle key; `CHECK`s for quantities, prices, percentages, date ordering and `amount_paid <= total_amount`.
- **Passwords** are bcrypt-hashed (cost 10 by default, configurable). Password reset tokens are single-use, hashed in storage and expire in an hour.
- **Role and tenant checks** live in the service layer *and* at the route (`requireRole`), and the portal routes always scope by the session customer.
- **HTTP hardening**: `helmet`, CORS restricted to the configured client origin, a body-size limit, and typed errors that never leak SQL or stack traces to the client.
- **Secrets** live in `server/.env` only; `.env` is git-ignored and `.env.example` carries placeholders.

## Verification performed

- `tsc --noEmit` and production builds pass for both packages.
- All ten staff/admin screens and the customer portal were driven in a headless browser at 1440 px and 420 px: **0 console errors or warnings**, no horizontal page overflow, every page under 700 ms.
- The full lifecycle was exercised end to end through the UI and the API: sign-up → staff-created contract from a template → quotation accepted by the customer → activated → billing run → invoice sent → payment recorded → paid; plus pause/resume, early close, renewal, discount expiry, plan retirement and the customer isolation cases.
- The billing engine was re-run against a paid contract to confirm the unique cycle key prevents double-billing, and against thousands of seeded records to confirm the timings above.

## Known limits

These are deliberate trade-offs, recorded rather than hidden:

- **No job scheduler.** `auto_close` and expiry are enforced during the next billing-day run (and on renewal/pause guards), not by a cron process — the system has no background worker by design.
- **Stateless JWTs.** Resetting a password does not revoke tokens already issued; there is no session table. The token lifetime is bounded by `JWT_EXPIRES_IN`.
- **One tax rate per contract.** Rates are resolved from the contract or the default rule, not per product, which matches the brief's "admin-configured tax rules" scope.
- **Missed cycles are not back-billed.** A contract whose billing date is months in the past receives one invoice for the current period instead of a burst of catch-up invoices.
- **No payment reversal.** Receipts are append-only; a mistaken payment has no delete path (the invoice also cannot be cancelled once paid).

## Documentation

- **`DEFENSE_LOG.md`** — every table, route, service and screen, with a plain-English walkthrough, the design rationale, and prepared evaluator Q&A. It is the companion to this README: the README explains how to run and understand the system, the log explains why each decision was made.
