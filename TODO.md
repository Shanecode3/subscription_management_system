# Master Implementation Roadmap & Hourly Milestones
## Brightloop Software — Subscription Management System
**Hackathon:** Odoo × Make-A-Ton 9.0  
**Schedule:** 09:00 AM – 04:30 PM IST (Cutoff: 05:00 PM IST)  
**Execution Branch:** `main` (Strict Single Branch Rule)  
**Evaluator Collaborators:** `hackathon-odoo`, `krip-odoo` (Krishna Patel, `krip@odoo.com`)

---

## 0. Hackathon Operational Protocol & Non-Negotiables

- [ ] **Single Branch Rule:** Never create feature branches. All work is built, tested, and pushed directly to `origin main`.
- [ ] **Hourly Commit Cadence:** Push to `origin main` at least once every 60 minutes with clear conventional commit messages.
- [ ] **Evaluator Collaborator Invites (Before 10:00 AM):** Add `hackathon-odoo` and `krip-odoo` as collaborators on the GitHub repository.
- [x] **Live Defense Log (`DEFENSE_LOG.md`):** Update `DEFENSE_LOG.md` upon completing every component with:
  1. File & Component name.
  2. How It Works (plain English flow).
  3. Why This Design (architectural justification).
  4. Q&A Defense Answers (2 anticipated evaluator bot questions + 2-sentence answers).
- [ ] **Strict BaaS Prohibition:** Strictly zero Firebase, Supabase, or cloud BaaS. Native local PostgreSQL 18 on `localhost:5432`.
- [ ] **Sub-2-Second Rule:** Every page and dashboard metric must execute in under 2 seconds.

---

## Milestone 1: Foundation, Local PostgreSQL Schema, Auth & RBAC
**Time Window:** 09:00 AM – 10:00 AM IST  
**Target Commit Time:** 10:00 AM IST  
**Commit Message:** `feat: database schema, auth system, and rbac middleware`  
**Status:** ✅ **COMPLETE** — schema, auth, RBAC and auth UI verified end-to-end against PostgreSQL 18

### User Stories
- **US1.1:** *As a Customer*, I want to sign up with my email and a strong password so that I have a secure personal account.
- **US1.2:** *As an Admin*, I want to create internal staff accounts so that staff can manage daily operations without having admin privileges.
- **US1.3:** *As a User*, I want a password reset flow so that I can regain access if I forget my password.

### Acceptance Criteria (Given / When / Then)
- **AC1.1 (Signup Validation):** Given an email and password, When password is $\le 8$ characters or lacks uppercase, lowercase, or special character (`^(?=.*[a-z])(?=.*[A-Z])(?=.*[^a-zA-Z0-9]).{9,}$`), Then return HTTP 400 with a specific validation error. ✅ *Returns every broken rule, not just the first.*
- **AC1.2 (Email Uniqueness):** Given an email that already exists, When user attempts to register, Then return HTTP 409 Conflict with message `"Email already registered"`. ✅ *Case-insensitive; verified with `test.customer@example.com` vs `Test.Customer@Example.com`.*
- **AC1.3 (RBAC Enforcement):** Given a user with role `STAFF` or `CUSTOMER`, When attempting to POST to `/api/v1/admin/users/staff`, Then reject with HTTP 403 Forbidden. ✅ *Verified for both roles.*
- **AC1.4 (Password Reset):** Given a registered email, When requested via `/api/v1/auth/forgot-password`, Then generate a 1-hour expiring crypto token and allow reset via `/api/v1/auth/reset-password`. ✅ *Token stored as SHA-256 hash, single-use.*

### Task Checklist
- [x] **1.1 Workspace & Project Initialization:**
  - [x] Initialize Node.js TypeScript server (`server/package.json`) and React Vite client (`client/package.json`).
  - [x] Configure `tsconfig.json`, `tailwind.config.js`, and environment configs (`.env`).
  - [x] Configure Git user identity and verify remote `origin main`.
- [x] **1.2 PostgreSQL Relational Database Setup:**
  - [ ] Create database `brightloop_db` on local PostgreSQL 18 (`localhost:5432`) — **action required:** set the real password in `server/.env`, then run `npm run db:setup` inside `server/`. The create script is written and was verified against a disposable cluster; it cannot run without your instance's password.
  - [x] Implement `server/src/db/schema.sql` containing all 14 tables, constraints, foreign keys, and sequences.
  - [x] Build database connection pool `server/src/db/pool.ts` using native `pg.Pool`.
  - [x] Create database initialization script `npm run db:init` to execute `schema.sql`.
- [x] **1.3 Authentication & RBAC Backend:**
  - [x] Implement password complexity regex validator in `server/src/utils/validators.ts`.
  - [x] Create `server/src/services/auth.service.ts` (bcrypt password hashing, JWT issue/verify).
  - [x] Implement auth routes in `server/src/routes/auth.routes.ts` (`/signup`, `/login`, `/forgot-password`, `/reset-password`, `/me`).
  - [x] Implement RBAC middleware `server/src/middleware/auth.middleware.ts` (`requireRole(['ADMIN'])`, etc.).
  - [x] Implement staff creation route `POST /api/v1/admin/users/staff` (Admin-only restricted).
- [x] **1.4 Seed Data Script:**
  - [x] Create `server/src/db/seed.ts` seeding default accounts:
    - Admin: `admin@brightloop.com` / `Brightloop@2026`
    - Staff: `staff@brightloop.com` / `Brightloop@2026`
    - Customer: `customer@brightloop.com` / `Brightloop@2026`
- [x] **1.5 Frontend Auth & Role Switcher UI:**
  - [x] Build clean Auth pages (`Login.tsx`, `Signup.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx`).
  - [x] Build Header component with persistent Role Switcher badge (`ADMIN` / `STAFF` / `CUSTOMER`).
- [x] **1.6 Verification & Commit:**
  - [x] Run backend auth tests & verify password validation edge cases.
  - [ ] Add collaborators `hackathon-odoo` and `krip-odoo` on GitHub — **action required:** repository-admin task; must be done from your GitHub account before 10:00 AM.
  - [x] Update `DEFENSE_LOG.md` (Milestone 1 entries).
  - [x] Git commit and push to `origin main`.

---

## Milestone 2: Products, Variants, Subscription Plans & Quotation Templates
**Time Window:** 10:00 AM – 11:15 AM IST  
**Target Commit Time:** 11:15 AM IST  
**Commit Message:** `feat: product variants, subscription plans, and quotation templates`

### User Stories
- **US2.1:** *As an Admin*, I want to define products and variants (such as Brand = "Odoo" adding +560) so that sales reps can offer customized packages.
- **US2.2:** *As an Admin*, I want to create subscription plans with custom billing intervals (daily, weekly, monthly, yearly) and lifecycle flags so that contracts behave according to our sales policies.
- **US2.3:** *As a Sales Rep (Staff)*, I want to use pre-configured quotation templates with default plans and products so that I can draft customer proposals in seconds.

### Acceptance Criteria (Given / When / Then)
- **AC2.1 (Odoo Brand Variant Rule):** Given a product with base sales price $X$ and variant Brand = "Odoo" with `price_extra = 560`, When added to a quotation, Then effective line price is $X + 560$.
- **AC2.2 (Plan Flags):** Given a subscription plan, When configured with flags `auto_close`, `allow_early_close`, `allow_pause`, `allow_renew`, Then these flags persist and govern subscription behavior.
- **AC2.3 (Template Line Pre-fill):** Given a quotation template with 2 product lines, When selected, Then pre-fill the quotation with those exact products, quantities, and prices.

### Task Checklist
- [x] **2.1 Products & Variants Module:**
  - [x] Implement `server/src/routes/product.routes.ts` & `product.service.ts` (CRUD for products: `Software`, `Service`, `Add-on`).
  - [x] Implement variant endpoints `POST /api/v1/products/:id/variants` (attribute name, value, price_extra).
  - [x] Seed default catalog items:
    - *Brightloop Enterprise ERP* ($1,200/mo) with variant *Brand = "Odoo"* (+560).
    - *Cloud Infrastructure Add-on* ($150/mo).
    - *Priority Support 24/7* ($300/mo).
- [x] **2.2 Subscription Plans Module:**
  - [x] Implement `server/src/routes/plan.routes.ts` & `plan.service.ts`.
  - [x] Validate billing intervals (`daily`, `weekly`, `monthly`, `yearly`) and date availability.
  - [x] Persist lifecycle flags: `auto_close`, `allow_early_close`, `allow_pause`, `allow_renew`.
  - [x] Seed default plans (Monthly Pro, Annual Enterprise with auto_close, Flexible Daily Trial).
- [x] **2.3 Quotation Templates Module:**
  - [x] Implement `server/src/routes/template.routes.ts` & `template.service.ts`.
  - [x] Support template header (`validity_days`, `plan_id`) and itemized template lines.
- [x] **2.4 Frontend Catalog & Plans Management:**
  - [x] Build `ProductsView.tsx` with variant modal and Odoo +560 price tag preview.
  - [x] Build `PlansView.tsx` displaying plan cards, billing frequencies, and toggle badges for plan flags.
  - [x] Build `TemplatesView.tsx` showing pre-configured offer packages.
- [x] **2.5 Verification & Commit:**
  - [x] Verify API endpoints for products, variants, and plans — 61/61 live assertions passed, including AC2.1, AC2.2 and AC2.3.
  - [x] Update `DEFENSE_LOG.md` (Milestone 2 entries).
  - [x] Git commit and push to `origin main`.

---

## Milestone 3: Quotation-to-Subscription Pipeline & Customer Portal
**Time Window:** 11:15 AM – 12:30 PM IST  
**Target Commit Time:** 12:30 PM IST  
**Commit Message:** `feat: subscription lifecycle state machine and customer self-service portal`

### User Stories
- **US3.1:** *As a Sales Rep*, I want to turn a quotation template into an active subscription with sequential numbering so that contracts are clearly tracked.
- **US3.2:** *As a Team Member*, I want to view a visual state pipeline for each subscription so that I instantly know its status.
- **US3.3:** *As a Customer*, I want to log into my portal to view only my own subscriptions, toggle add-ons, and pause/resume/close my plan according to permitted flags.

### Acceptance Criteria (Given / When / Then)
- **AC3.1 (Sequential Numbering):** Given a new subscription, When created, Then assign next sequential number `SUB-2026-XXXX` via PostgreSQL sequence `seq_subscription_number`.
- **AC3.2 (Visual State Progression):** Given a subscription, When progressing through states, Then follow strict sequence: `Draft` → `Quotation` → `Confirmed` → `Active` → `Closed` (with `Paused` supported when `allow_pause = TRUE`).
- **AC3.3 (Customer Portal Isolation):** Given a logged-in customer, When requesting subscriptions, Then return only subscriptions where `customer_id = token.userId`. Never expose other customers' records.
- **AC3.4 (Add-on Toggling & Plan Flags):** Given an active subscription with an add-on line, When customer toggles add-on, Then update `is_addon_active` and recalculate line subtotal. If customer attempts to pause when `allow_pause = FALSE`, reject with HTTP 400.

### Task Checklist
- [x] **3.1 Subscription Engine & Numbering:**
  - [x] Implement `server/src/routes/subscription.routes.ts` & `subscription.service.ts`.
  - [x] Implement `createFromTemplate` and manual subscription creation using PostgreSQL sequence `seq_subscription_number`.
  - [x] Implement subscription lines breakdown (`product_id`, `variant_id`, `unit_price`, `quantity`, `subtotal`, `is_addon`, `is_addon_active`).
- [x] **3.2 Lifecycle State Machine:**
  - [x] Implement transition logic: `Draft` → `Quotation` → `Confirmed` → `Active` → `Closed` / `Paused`.
  - [x] Enforce plan rules: check `allow_pause` before setting `Paused`, check `allow_early_close` before setting `Closed`, check `allow_renew` before renewing.
- [x] **3.3 Customer Portal Endpoints:**
  - [x] Implement `/api/v1/portal/subscriptions` (enforcing customer tenant filter).
  - [x] Implement `/api/v1/portal/subscriptions/:id/addons` (toggle add-on on/off).
  - [x] Implement `/api/v1/portal/subscriptions/:id/pause`, `/resume`, `/early-close`, `/renew`.
- [x] **3.4 Frontend Subscription Views & Stepper Component:**
  - [x] Build `SubscriptionDetailPage.tsx` with visual status stepper bar (`Draft → Quotation → Confirmed → Active → Closed`).
  - [x] Build staff subscription list with filter by status (`Draft`, `Active`, etc.).
  - [x] Build `PortalPage.tsx` showing active plans, interactive Add-on switches, and self-service action buttons (Pause, Early Close, Renew).
- [x] **3.5 Verification & Commit:**
  - [x] Verify template-to-subscription conversion and state transitions — 62/62 live assertions, including AC3.1, AC3.2, AC3.3 and AC3.4.
  - [x] Test customer tenant isolation and add-on toggling.
  - [x] Update `DEFENSE_LOG.md` (Milestone 3 entries).
  - [x] Git commit and push to `origin main`.

---

## Milestone 4: Tax Rules, Admin Discount Engine & Automated Billing Day
**Time Window:** 12:30 PM – 01:45 PM IST  
**Target Commit Time:** 01:45 PM IST  
**Commit Message:** `feat: automated billing day engine, taxes, discounts, and invoice management`

### User Stories
- **US4.1:** *As an Admin*, I want to create tax rules and discount rules with usage limits and purchase thresholds so that billing calculates accurate prices automatically.
- **US4.2:** *As Internal Staff*, I want a one-click "Billing Day" run that generates invoices for all due active subscriptions without duplicate billing or skipped records.
- **US4.3:** *As a Team Member*, I want to confirm, cancel, send, and print invoices with an automatic invoice lifecycle (`Draft` → `Confirmed` → `Paid`).

### Acceptance Criteria (Given / When / Then)
- **AC4.1 (Admin-Only Discount Creation):** Given a non-admin user, When attempting to create a discount rule, Then return HTTP 403 Forbidden.
- **AC4.2 (Discount Expiry & Usage Caps):** Given a discount with `max_uses = 10` or past `end_date`, When billing engine runs, Then do not apply discount and de-link from future invoices.
- **AC4.3 (Idempotent Billing Run):** Given 10 due active subscriptions, When clicking "Execute Billing Day" twice in a row, Then the first run generates 10 invoices and the second run generates 0 invoices (zero duplicate billing guaranteed via `UNIQUE(billing_cycle_key)`).
- **AC4.4 (Invoice Printable Layout):** Given any invoice, When clicking "Print", Then display a clean printable invoice layout with company header, line item table, tax breakdown, and totals.

### Task Checklist
- [ ] **4.1 Tax Rules Module:**
  - [ ] Implement `server/src/routes/tax.routes.ts` & `tax.service.ts` (Admin-managed rates, e.g., GST 18%, VAT 10%).
- [ ] **4.2 Admin Discount Engine:**
  - [ ] Implement `server/src/routes/discount.routes.ts` & `discount.service.ts` (Admin-restricted).
  - [ ] Implement validation rules: fixed vs percentage, min purchase amount, min quantity, date range, max usage limit.
  - [ ] Implement scope logic: `whole_subscription` vs `specific_product`.
  - [ ] Atomically increment `current_uses` and auto-expire rules.
- [ ] **4.3 Idempotent Billing Day Engine:**
  - [ ] Implement `server/src/services/billing.engine.ts` with batch processing inside a PostgreSQL transaction (`BEGIN`/`COMMIT`).
  - [ ] Fetch all due active subscriptions: `WHERE status = 'Active' AND next_billing_date <= CURRENT_DATE`.
  - [ ] Form idempotency key: `sub_{id}_{next_billing_date}` and enforce `UNIQUE(billing_cycle_key)`.
  - [ ] Generate sequential invoice numbers: `INV-2026-XXXX`.
  - [ ] Calculate lines, discounts, taxes, and advance `next_billing_date` by interval (`daily`, `weekly`, `monthly`, `yearly`).
  - [ ] Auto-close subscriptions if `auto_close = TRUE` and expiry reached.
- [ ] **4.4 Invoice Management & Actions:**
  - [ ] Implement invoice action routes: `/confirm`, `/cancel`, `/send`, `/print`.
  - [ ] Invoice state machine: `Draft` → `Confirmed` → `Paid` (or `Cancelled`).
- [ ] **4.5 Frontend Billing Day & Invoice Studio:**
  - [ ] Build `BillingDayView.tsx` with "Execute Billing Day" trigger, due subscriptions preview, and audit summary log.
  - [ ] Build `InvoiceDetailView.tsx` with action buttons (Confirm, Cancel, Send, Print).
  - [ ] Build clean printable layout `@media print` in `PrintInvoiceView.tsx`.
- [ ] **4.6 Verification & Commit:**
  - [ ] Test double-billing prevention by executing billing run multiple times.
  - [ ] Verify discount usage limit and auto-close on contract expiry.
  - [ ] Update `DEFENSE_LOG.md` (Milestone 4 entries).
  - [ ] Git commit and push to `origin main`.

---

## Milestone 5: Payment Recording, Ledger & Invoice Status Reconciliation
**Time Window:** 01:45 PM – 03:00 PM IST  
**Target Commit Time:** 03:00 PM IST  
**Commit Message:** `feat: payment recording engine and invoice reconciliation`

### User Stories
- **US5.1:** *As Internal Staff*, I want to record payments against invoices by method, amount, date, and note so that payments are matched immediately.
- **US5.2:** *As a Team Member*, I want invoices to automatically transition from `Confirmed` to `Paid` once fully paid, and track partial balances accurately.
- **US5.3:** *As a Finance Lead*, I want to clearly distinguish between paid, outstanding, and overdue invoices so overdue debts can be chased immediately.

### Acceptance Criteria (Given / When / Then)
- **AC5.1 (Payment Recording):** Given a confirmed invoice of $1,000, When staff records payment of $1,000, Then create payment record with sequential number `PAY-2026-XXXX`, update `amount_paid = 1000`, and set invoice status to `Paid`.
- **AC5.2 (Partial Payments):** Given an invoice of $1,000, When staff records payment of $400, Then update `amount_paid = 400`, keep status as `Confirmed`, and reflect remaining balance of $600.
- **AC5.3 (Overdue Detection):** Given an invoice with `status = 'Confirmed'` and `due_date < CURRENT_DATE`, When evaluated by the system, Then classify as Overdue and calculate days overdue.

### Task Checklist
- [ ] **5.1 Payment Engine & Ledger:**
  - [ ] Implement `server/src/routes/payment.routes.ts` & `payment.service.ts`.
  - [ ] Assign sequential payment numbering `PAY-2026-XXXX` via `seq_payment_number`.
  - [ ] Support payment methods: `Bank Transfer`, `Credit Card`, `UPI`, `Cash`.
  - [ ] Record `payment_date`, `amount`, `reference_note`, and `recorded_by`.
- [ ] **5.2 Automatic Invoice Reconciliation:**
  - [ ] Atomic database transaction: insert payment + increment `invoices.amount_paid`.
  - [ ] Transition invoice to `Paid` when `amount_paid >= total_amount`.
  - [ ] Reconcile outstanding balances across all customer invoices.
- [ ] **5.3 Payment History & Overdue Ledger API:**
  - [ ] Implement `/api/v1/payments` list with filter by customer, invoice, and date range.
  - [ ] Implement `/api/v1/invoices/overdue` endpoint returning overdue invoices with `days_overdue` and `balance_due`.
- [ ] **5.4 Frontend Payment Modal & Invoice Reconciliation UI:**
  - [ ] Build "Record Payment" modal on `InvoiceDetailView.tsx`.
  - [ ] Render Payment History table on the invoice with payment method badges.
  - [ ] Add Paid/Outstanding/Overdue status filters on `InvoicesListView.tsx`.
- [ ] **5.5 Verification & Commit:**
  - [ ] Verify full and partial payment reconciliations.
  - [ ] Test overdue invoice calculations.
  - [ ] Update `DEFENSE_LOG.md` (Milestone 5 entries).
  - [ ] Git commit and push to `origin main`.

---

## Milestone 6: Sub-2-Second Finance Lead Dashboard, Performance Seeding & Polish
**Time Window:** 03:00 PM – 04:30 PM IST  
**Target Commit Time:** 04:30 PM IST  
**Commit Message:** `feat: finance lead dashboard with sub-2s query optimizations and seed data`

### User Stories
- **US6.1:** *As the Finance Lead*, I want a single unified dashboard showing active subscriptions, MRR/ARR, revenue collected, outstanding owed, and overdue invoices with filters so that I can analyze company performance in seconds.
- **US6.2:** *As the Evaluator*, I want the platform to maintain sub-2-second response times even with thousands of subscriptions on the books.

### Acceptance Criteria (Given / When / Then)
- **AC6.1 (Finance Summary Metrics):** Given thousands of subscriptions and invoices, When Finance Dashboard loads, Then return Active Subscriptions count, MRR, ARR, Total Revenue Collected, Total Outstanding, and Overdue List in $< 2$ seconds.
- **AC6.2 (Dynamic Filtering):** Given date range, plan, or customer filters, When applied on the dashboard, Then recalculate all metrics dynamically in real-time.
- **AC6.3 (Mass Performance Benchmark):** Given a database seeded with 1,000+ realistic subscriptions and invoices, When loading any page or running the dashboard, Then database response time is $< 200\text{ ms}$ (well below the 2s threshold).

### Task Checklist
- [ ] **6.1 High-Speed Finance Aggregation Service:**
  - [ ] Implement `server/src/services/finance.service.ts` using direct SQL `COUNT`/`SUM` aggregations with interval multipliers.
  - [ ] Optimize composite B-Tree indexes: `idx_subs_active_billing`, `idx_invoices_status_due`, `idx_payments_date_amount`.
  - [ ] Implement `/api/v1/finance/dashboard` with query filters (`startDate`, `endDate`, `planId`, `customerId`).
- [ ] **6.2 Performance Benchmark Seeding Script:**
  - [ ] Build `server/src/db/seed_performance.ts` generating 1,000+ realistic subscriptions, 2,500+ invoices, and 1,500+ payments.
  - [ ] Include automated execution time benchmark testing query speeds with `EXPLAIN ANALYZE` and logging response times.
- [ ] **6.3 Frontend Finance Lead Executive Dashboard:**
  - [ ] Build `FinanceDashboardView.tsx` with 4 KPI cards:
    - Active Subscriptions & MRR/ARR Breakdown.
    - Total Revenue Collected.
    - Total Outstanding Debt.
    - Total Overdue Debt.
  - [ ] Interactive filter toolbar (Date range, Plan picker, Customer picker).
  - [ ] Overdue Invoices chase table with customer details, days overdue, and 1-click link to record payment.
- [ ] **6.4 End-to-End System Polish & Role Switcher:**
  - [ ] Conduct complete end-to-end walkthrough covering all 6 scenes.
  - [ ] Verify zero console errors, zero dead links, responsive layouts, and clean typography.
  - [ ] Test instant role switching between `ADMIN`, `STAFF`, and `CUSTOMER`.
- [ ] **6.5 Final Verification, Documentation & Cutoff Preparation:**
  - [ ] Complete all sections of `DEFENSE_LOG.md` for all 6 milestones.
  - [ ] Run final production build test (`npm run build`).
  - [ ] Git commit and push to `origin main` before 04:30 PM.

---

## 7. Submission & Demo Pre-Flight Checklist (04:30 PM – 05:00 PM IST)

- [ ] **Coding Cutoff (05:00 PM IST):** Final commit verified on `origin main`.
- [ ] **Collaborators Verified:** `hackathon-odoo` and `krip-odoo` confirmed on repo.
- [ ] **Local Database Running:** PostgreSQL 18 verified with seed data ready for evaluation.
- [ ] **DEFENSE_LOG.md Complete:** All technical questions and design rationales documented.
- [ ] **Demo Video (05:00 PM – 05:30 PM IST):**
  - [ ] Record 5–6 minute high-resolution demo walkthrough covering all 6 scenes:
    1. Scene 1: Signup with 9+ complex password, duplicate email check, forgot password, RBAC demo.
    2. Scene 2: Product & variant creation (Odoo brand +560 rule), subscription plans with flags.
    3. Scene 3: Quotation template to subscription, status progression bar, customer portal view with add-on toggling.
    4. Scene 4: Admin discount creation, Billing Day one-click batch run, idempotency check, invoice print view.
    5. Scene 5: Payment recording, automatic status reconciliation (`Confirmed` → `Paid`), partial payment.
    6. Scene 6: Finance Lead Dashboard, real-time KPI metrics, sub-2-second performance with 1,000+ subscriptions.
  - [ ] Upload video with open-access link and submit before 05:30 PM IST.

