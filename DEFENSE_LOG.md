# Brightloop Software — Live Q&A Defense Log

**Project:** Unified Subscription Management System
**Hackathon:** Odoo × Make-A-Ton 9.0
**Evaluation target:** local PostgreSQL 18 + Node.js/Express + React 18
**Log format:** each entry records (1) File & Component, (2) How It Works, (3) Why This Design, (4) two likely evaluator questions with two-sentence answers.

---

## Milestone 1 — Foundation, PostgreSQL Schema, Auth & RBAC

**Commit scope:** project scaffold, 14-table relational schema, connection pooling, database tooling, authentication service, RBAC middleware, uniform error handling, seeded accounts, and the authentication UI.
**Verified:** both workspaces compile (`tsc`), the client bundles (`vite build`), the schema applies twice in a row without error, and every auth/RBAC path was exercised end-to-end against a live PostgreSQL 18 instance.

### Repository layout

```
server/
  src/config/env.ts            environment parsing + fail-fast validation
  src/db/schema.sql            14-table DDL, constraints, indexes, triggers
  src/db/pool.ts               pg.Pool singleton, query helper, transactions
  src/db/create-database.ts    creates brightloop_db if it does not exist
  src/db/init.ts               applies schema.sql (idempotent)
  src/db/seed.ts               seeds Admin, Staff and Customer demo accounts
  src/repositories/            SQL only — one module per aggregate
  src/services/                business rules only — no SQL strings
  src/middleware/              auth, validation, error, request logging
  src/routes/                  HTTP surface only — no business rules
  src/utils/                   errors, validators, JWT, logger, response
client/
  src/lib/                     api client, auth context, types, utilities
  src/components/ui/           Button, TextField, Alert, RoleBadge, checklist
  src/components/layout/       AuthLayout, AppShell, Header, ProtectedRoute
  src/pages/                   Login, Signup, ForgotPassword, ResetPassword, Dashboard
```

---

## 1. Database schema

**File:** `server/src/db/schema.sql`

### 1.0 Schema-wide decisions

**How it works.** The file runs as a single transaction (`BEGIN … COMMIT`). It creates three sequences for human-readable document numbers, fourteen tables in dependency order, functional and partial indexes, and one shared `set_updated_at()` trigger function attached to every table that carries an `updated_at` column. Every statement uses `IF NOT EXISTS`, and each trigger is dropped before recreation, so the file can be applied repeatedly.

**Why this design.** One transaction means a half-built schema is impossible — either all fourteen tables exist or none do. Foreign keys are declared at the table level rather than added later so the schema is self-documenting, and `ON DELETE` behaviour is chosen per relationship instead of defaulting to `NO ACTION` everywhere: child rows that have no meaning without the parent (`subscription_lines`, `invoice_lines`, `quotation_template_lines`, `product_variants`) cascade; rows that are referenced by financial documents are `RESTRICT`-ed, so a product or customer that already appears on an invoice cannot be deleted and silently orphan the ledger.

**Q&A — Why normalise to 3NF instead of storing invoice totals as a JSON blob?**
Because money must be queryable and reconcilable. Normalised `invoice_lines` let `SUM()` compute revenue, tax and discount totals inside PostgreSQL with indexes, while a JSON blob would force the application to parse every row to answer basic finance questions.
**Q&A — What stops a partially applied schema?**
The whole script is wrapped in a single transaction, and DDL in PostgreSQL is transactional. If any statement fails, `COMMIT` never runs and PostgreSQL rolls back every object created in that block.

---

### 1.1 `users` — identity and role

**How it works.** Holds one row per login: name, unique email, bcrypt `password_hash`, a `role` constrained to `ADMIN` / `STAFF` / `CUSTOMER`, optional profile fields, a reset-token pair, and an `is_active` flag. A `UNIQUE` constraint covers `email`, and a second functional unique index covers `LOWER(email)`.

**Why this design.** A single table with a role column keeps authentication uniform — one login query, one password-check path, one session format — while the role drives authorisation downstream. The functional index exists because email is the login identifier: without it, `Shane@x.com` and `shane@x.com` would be two accounts and the uniqueness rule could be bypassed by changing capitalisation. The reset token and its expiry are a pair guarded by `chk_users_reset_pair`, which makes a half-issued reset (token with no expiry, or the reverse) impossible at the storage layer.

**Q&A — Why is there both a `UNIQUE` constraint on `email` and a unique index on `LOWER(email)`?**
The column constraint guarantees exact-value uniqueness and gives the API a stable, predictable error, while the functional index enforces the business rule that email comparison is case-insensitive. Belt and braces: the service normalises to lowercase on write, and the database rejects any path that forgets to.
**Q&A — What happens when a user is deleted?**
Customers and staff are never hard-deleted in this design. `is_active` and the `RESTRICT` rules on financial tables keep the audit trail intact, because deleting a customer who has invoices would either be blocked or destroy revenue history.

---

### 1.2 `products` — catalog

**How it works.** Stores `name`, a `type` restricted to `Software` / `Service` / `Add-on`, `sales_price`, `cost_price`, free-text `notes`, and an `is_active` flag. Prices are `NUMERIC(12,2)` with `CHECK (sales_price >= 0)` and `CHECK (cost_price >= 0)`.

**Why this design.** `NUMERIC(12,2)` rather than `FLOAT` because binary floating point cannot represent `0.10` exactly and will drift when a price is multiplied across thousands of invoice lines. The `CHECK` constraints are the last line of defence against a negative price reaching the ledger, independent of whatever validation the API performs.

**Q&A — Why not store money as an integer of cents?**
Integer cents is a valid alternative, but `NUMERIC` is exact decimal in PostgreSQL, keeps the SQL readable for an evaluator, and avoids conversion bugs at every boundary. The `CHECK` and `NUMERIC(12,2)` typing give the same correctness guarantee.
**Q&A — What does `is_active` protect against?**
It lets Brightloop retire a product without deleting rows that historical invoices still reference. Deleting instead would be blocked by the `RESTRICT` foreign keys from `subscription_lines` and `invoice_lines`.

---

### 1.3 `product_variants` — the +560 rule at the data layer

**How it works.** Each row belongs to a product and carries `attribute_name`, `attribute_value`, `price_extra` and an optional `sku`. `UNIQUE (product_id, attribute_name, attribute_value)` prevents defining the same option twice, and `ON DELETE CASCADE` removes the variants when the product itself is deleted.

**Why this design.** The variant surcharge is stored as a delta (`price_extra`) instead of a full price, so changing the base price of a product automatically flows to every variant rather than requiring an update to each one. The composite unique key is the data-level expression of "a product can offer Brand = Odoo exactly once".

**Q&A — How is the effective price of a variant computed?**
The line price is the product's `sales_price` plus every selected variant's `price_extra`, so a 1,200.00 product with `Brand = Odoo (+560.00)` bills at 1,760.00. Keeping the delta separate means a base-price change never leaves variants stale.
**Q&A — Why use a generic attribute name/value pair instead of a `brand` column?**
Products can vary by brand, edition or storage. A generic pair lets the same table express all three without schema changes, and the composite unique constraint still guarantees each value is defined once per product.

---

### 1.4 `subscription_plans` — interval and lifecycle flags

**How it works.** Stores the plan `name`, `price`, a `billing_interval` restricted to `daily` / `weekly` / `monthly` / `yearly`, `min_quantity`, an availability window, and four boolean flags: `auto_close`, `allow_early_close`, `allow_pause`, `allow_renew`.

**Why this design.** The flags live on the plan rather than on each subscription so that policy is defined once and inherited by every contract sold under it — changing a plan's pause policy immediately governs all its subscriptions. `chk_plan_availability_dates` prevents an availability window that ends before it starts, which would make the plan permanently unsellable and is otherwise only discoverable from a confusing empty result set.

**Q&A — Why are the lifecycle permissions booleans on the plan and not a role check?**
Because "can this contract be paused" is a commercial term of the product, not a property of the person clicking. The portal will check the flag and the user's ownership, and both must pass.
**Q&A — How does `billing_interval` stay trustworthy?**
It is a `CHECK`-constrained enumeration, so no code path can insert `fortnightly` and produce an undefined billing cycle. The billing engine (Milestone 4) maps each allowed value to exactly one date arithmetic branch.

---

### 1.5 `quotation_templates` — reusable offer packages

**How it works.** A template has a name, a required `plan_id`, `validity_days` (default 30, must be positive) and notes. `plan_id` is `ON DELETE RESTRICT`.

**Why this design.** Templates are sales artefacts that must always reference a live plan, so deleting a plan that templates depend on is refused rather than leaving dangling offers. `validity_days` is stored as a duration rather than an absolute date because a template is reused for many quotations — an absolute expiry date would make it single-use.

**Q&A — Why store `validity_days` instead of `valid_until`?**
The template is a reusable pattern; its validity is "30 days from the day you quote it". An absolute date would expire the template itself and force a new row for every month of selling.
**Q&A — What breaks if a plan is deleted while templates reference it?**
Nothing breaks, because the deletion is refused — `ON DELETE RESTRICT` raises a foreign-key violation that the API maps to a clear "still in use" message.

---

### 1.6 `quotation_template_lines` — the pre-selected products

**How it works.** Each line links a template to a product, optionally a variant, with `quantity` (must be > 0) and `unit_price` (must be >= 0). `ON DELETE CASCADE` from the template removes the lines with it; `product_id` is `RESTRICT`.

**Why this design.** The line set is owned by the template and has no independent identity, which is exactly what `CASCADE` expresses. The product is the opposite case: a template line that outlived its product would be a broken offer, so the product delete is refused. `unit_price` is captured on the line so a later catalogue price change does not silently alter an offer that was already configured.

**Q&A — Why snapshot `unit_price` on the template line when the product already has a price?**
Because the negotiated offer is a business record. If the catalogue price changes tomorrow, an offer configured today must still reproduce the price the salesperson intended.
**Q&A — How does a template pre-fill a quotation?**
The service reads the template header for the plan and validity, then copies each line's product, variant, quantity and price into the new subscription's lines in one transaction.

---

### 1.7 `tax_rules`

**How it works.** Holds a tax `name` (for example `GST 18%`), a `rate` constrained to `0–100`, `is_active`, and `is_default`. A partial unique index (`uq_tax_rules_single_default … WHERE is_default = TRUE`) allows at most one default at a time.

**Why this design.** The rate is a percentage with a `CHECK` ceiling, so a data-entry slip of `180` instead of `18` is rejected rather than producing an invoice that is ten times too expensive. The partial unique index is the cleanest way to express "zero or one default" in PostgreSQL — a plain unique constraint would allow only one row in the entire table.

**Q&A — Why is the rate stored per rule instead of hard-coded in the billing engine?**
Because tax rates change and differ by jurisdiction, and the brief requires Admin-configured rules. Storing the percentage keeps the engine generic: it reads a rate, it does not know about GST.
**Q&A — How do you guarantee only one default tax rule?**
With a partial unique index on `is_default` filtered to `WHERE is_default = TRUE`, so the database itself refuses a second default rather than relying on application logic.

---

### 1.8 `discount_rules` — Admin-authored, self-expiring

**How it works.** Stores `name`, unique `code`, `discount_type` (`percentage`/`fixed`), `discount_value`, `scope` (`whole_subscription`/`specific_product`), an optional `target_product_id`, thresholds (`min_purchase_amount`, `min_quantity`), an active window (`start_date`, `end_date`), `max_uses`, `current_uses`, and `created_by`.

**Why this design.** The usage cap is enforced by two mechanisms: `CHECK (current_uses <= max_uses)` makes an over-consumed rule impossible to store, and the billing engine increments atomically with `UPDATE … WHERE current_uses < max_uses RETURNING id` so two concurrent invoices cannot both claim the final use. `chk_discount_scope_target` encodes the scope rule structurally — a product-scoped discount must name a product, a whole-subscription discount must not — which removes a whole class of "discount silently applies to nothing" bugs. `created_by` is `RESTRICT` so the audit trail cannot be erased.

**Q&A — How do you stop two invoices consuming the same last discount use?**
The increment is a single conditional `UPDATE` that only matches when `current_uses < max_uses`; PostgreSQL row locking means the second transaction sees zero matching rows and the discount is refused.
**Q&A — Why store `scope` and `target_product_id` as two columns with a check instead of a nullable join table?**
Because a discount has exactly one scope, so a join table would model a many-to-many that the business does not have. The `CHECK` states the invariant in one place, and the query stays a simple read.
**Q&A — Does an expired discount need to be deactivated?**
No. Validity is evaluated at billing time from `start_date`/`end_date`, so an expired rule simply stops applying; `is_active` is reserved for an Admin deliberately switching a rule off.

---

### 1.9 `subscriptions` — the contract and its state machine

**How it works.** One row per contract: unique `subscription_number` (`SUB-2026-0001`), `customer_id`, `plan_id`, optional `template_id`, a `status` constrained to `Draft`/`Quotation`/`Confirmed`/`Active`/`Paused`/`Closed`, `start_date`, `expiry_date`, `payment_terms`, `next_billing_date`, discount and tax references, and `paused_at` / `closed_at` timestamps.

**Why this design.** The status is a database-level enumeration, so an invalid state is unrepresentable regardless of which code path writes it. `subscriptions` is also where the two lifecycle timestamps live, rather than an event table, because the portal only ever needs "when was this paused", and a dedicated history table can be added later without changing this contract. `next_billing_date` is denormalised from the plan interval on purpose: the billing run filters on it, and computing "is this due" from `start_date` plus an interval every time would defeat the index.

**Q&A — Why store `next_billing_date` when it could be derived from `start_date` and the interval?**
Because the billing run's hot query is "give me every active subscription due today", and a stored, indexed column turns that into an index range scan. Deriving it would require computing a date expression per row across the whole table.
**Q&A — How does the schema prevent a subscription expiring before it starts?**
`chk_sub_dates` requires `expiry_date IS NULL OR expiry_date >= start_date`, so the invalid range is rejected by PostgreSQL itself.

---

### 1.10 `subscription_lines` — itemised contract

**How it works.** Each line carries the product, optional variant, a description snapshot, `quantity`, `unit_price`, and the computed `discount_amount`, `tax_amount`, `subtotal` and `total_amount`, plus `is_addon` and `is_addon_active`.

**Why this design.** Add-ons are lines rather than a separate table because they are priced, taxed and invoiced identically to base lines — the only difference is a boolean. That keeps one calculation path instead of two divergent ones. `is_addon_active` lets a customer switch an add-on off without deleting history, which is what the portal toggle in Scene 3 requires.

**Q&A — Why not delete an add-on line when the customer switches it off?**
Deleting would erase the fact that the add-on was ever subscribed and would change already-issued invoice history. Flipping `is_addon_active` preserves the record while billing engines filter on it.
**Q&A — Why store `subtotal` and `total_amount` as columns instead of computing them in every query?**
Because the amount that was agreed is a business fact; recomputing it later from a changed price or tax rate would rewrite history. Storing the snapshot means an old line always shows the numbers the customer accepted.

---

### 1.11 `invoices` — idempotent billing

**How it works.** Each invoice has a unique `invoice_number`, the originating `subscription_id` and `customer_id`, a `billing_cycle_date`, and a `billing_cycle_key` with a `UNIQUE` constraint. It also stores the money roll-up (`subtotal`, `tax_total`, `discount_total`, `total_amount`, `amount_paid`), a status constrained to `Draft`/`Confirmed`/`Paid`/`Cancelled`, dates and audit timestamps.

**Why this design.** The unique `billing_cycle_key` (formatted `sub_{subscription_id}_{billing_cycle_date}`) is the single most important constraint in the system: it makes double-billing impossible at the storage layer, so even two concurrent billing runs, a retry after a timeout, or a double-clicked button produce exactly one invoice per period. `chk_invoice_paid_within_total` stops an overpayment being recorded, and `chk_invoice_dates` stops a due date before the issue date.

**Q&A — How do you guarantee a subscription is never billed twice for the same period?**
The invoice carries a unique `billing_cycle_key` built from the subscription id and cycle date, so the second insert violates a unique constraint and is skipped. The guarantee lives in the database, so it holds even if the application logic is wrong or two requests race.
**Q&A — Why store `tax_total` and `discount_total` separately from `subtotal`?**
Because the Finance dashboard must distinguish gross revenue, tax collected and discount given, and printing an invoice requires the breakdown. A single total would make those queries impossible after the fact.

---

### 1.12 `invoice_lines`

**How it works.** Invoice lines mirror subscription lines at the moment of billing: product, variant, description, quantity, unit price, discount, tax and total. `ON DELETE CASCADE` from the invoice, `RESTRICT` on the product.

**Why this design.** Invoices must be immutable snapshots. Copying the values rather than joining back to `subscription_lines` means a later change to a subscription — an add-on switched off, a price renegotiated — cannot retroactively alter an invoice that has already been sent.

**Q&A — Why duplicate the data instead of referencing subscription lines?**
Because an invoice is a legal record of what was billed on a date. A foreign key would let a future change to the subscription silently rewrite an already-issued invoice.
**Q&A — What happens to the lines if an invoice is deleted?**
They cascade with it. Invoice deletion is not exposed in the product; cancellation is a status change, precisely so this path is never used in practice.

---

### 1.13 `payments` — append-only ledger

**How it works.** Records `payment_number`, `invoice_id`, `customer_id`, `amount` (must be > 0), `payment_method` restricted to `Bank Transfer`/`Credit Card`/`UPI`/`Cash`, `payment_date`, `reference_note` and `recorded_by`.

**Why this design.** A payment is an event, so it is inserted and never edited — corrections are new compensating payments. That is why there is no `updated_at` here and why `amount > 0` is enforced: a negative payment would be a disguised edit. `recorded_by` names the staff member so every rupee can be traced to a person.

**Q&A — Why no `updated_at` on payments?**
Because payments are append-only. Allowing edits to a ledger entry would make reconciliation untrustworthy and complicate the audit trail.
**Q&A — Why restrict `payment_method` to four values?**
It is an enumeration from the brief, and a `CHECK` keeps reconciliation reports grouped correctly. Free text would produce `bank transfer`, `BankTransfer` and `BT` as three different methods.

---

### 1.14 `audit_logs`

**How it works.** Records `entity_type`, `entity_id`, `action`, `performed_by`, a JSONB `details` payload and a timestamp. `performed_by` is `ON DELETE SET NULL` so the log survives a user deletion; an index on `(entity_type, entity_id, created_at DESC)` makes per-entity history fast.

**Why this design.** JSONB is the one place denormalisation is appropriate: the shape of an audit detail differs per action, and it is written once and read for humans, never joined. `SET NULL` is chosen over `CASCADE` for the opposite reason to the financial tables — an audit entry must outlive the user it describes.

**Q&A — Why JSONB for `details` rather than columns?**
Because the payload differs per action (a staff creation logs an email, an invoice cancellation will log a reason). JSONB stores it without a sparse table of mostly-null columns.
**Q&A — Why allow `performed_by` to become NULL?**
So deleting a user never destroys the history of what was done. The action, entity and timestamp remain, which is what an auditor needs.

---

## 2. Database tooling

### 2.1 `server/src/db/create-database.ts`

**How it works.** Parses `DATABASE_URL`, swaps the path to the maintenance `postgres` database, connects, checks `pg_database` for the target name, and creates it if absent.

**Why this design.** `CREATE DATABASE` cannot run inside a transaction and cannot take a bind parameter, so it is isolated in its own script with an explicit identifier quote after validating the name. Keeping it separate from `db:init` means the schema script stays transactional and re-runnable.

**Q&A — Why not create the database inside `schema.sql`?**
PostgreSQL refuses `CREATE DATABASE` inside a transaction block, and `schema.sql` runs as one. Splitting it keeps the schema transactional and idempotent.
**Q&A — Is the database name safe from injection?**
The name comes from the environment, is validated to be non-empty, and is double-quoted with internal quotes doubled before interpolation, since identifiers cannot be parameterised.

### 2.2 `server/src/db/init.ts`

**How it works.** Resolves `schema.sql` from a list of candidate paths (so it works both under `tsx` and from `dist/`), executes it as one multi-statement query, then reports the table and index counts from `information_schema` and `pg_indexes`.

**Why this design.** Reading the file at runtime rather than embedding SQL in TypeScript keeps the schema diffable and reviewable as SQL. The post-run count is a cheap self-check: if the DDL silently did nothing, the report shows the wrong table count immediately.

**Q&A — How do you know the schema was actually applied?**
The script queries `information_schema.tables` afterwards and prints the table list and index count. A no-op would be visible immediately.
**Q&A — Is it safe to run on an existing database?**
Yes. Every object uses `IF NOT EXISTS` and triggers are dropped before recreation, so repeated runs are no-ops. Verified by applying the schema twice in a row during this milestone.

### 2.3 `server/src/db/pool.ts`

**How it works.** Creates one `pg.Pool` for the process with `max: 20`, 30-second idle timeout and a 10-second connect timeout. Exposes `query()` for single statements, `withTransaction()` for `BEGIN`/`COMMIT`/`ROLLBACK` with guaranteed `client.release()`, `isDatabaseReachable()` for health checks, and `closePool()` for shutdown.

**Why this design.** A single shared pool is the difference between forty connections under load and a PostgreSQL `too many clients` outage. `withTransaction` puts release in a `finally` block so an exception mid-transaction cannot leak a connection, and it rolls back before rethrowing so no partial write survives.

**Q&A — Why not create a client per request?**
Each client is a server-side connection with real memory cost, and PostgreSQL has a hard `max_connections`. A pool caps concurrency and reuses sockets.
**Q&A — What happens if a transaction throws halfway through?**
`withTransaction` issues `ROLLBACK`, logs any rollback failure, releases the client in a `finally` block, and rethrows so the global error handler can respond.

### 2.4 `server/src/db/seed.ts`

**How it works.** Hashes the shared demo password once, inserts three accounts (Admin, Staff, Customer) with `ON CONFLICT DO NOTHING`, then prints the resulting user count and the credentials.

**Why this design.** Hashing once and reusing is intentional: it makes the seed fast and makes the demo reproducible. `ON CONFLICT DO NOTHING` without a conflict target covers both the `email` constraint and the case-insensitive index, so re-running the seed can never half-fail.

**Q&A — Why is the demo password the same for all three accounts?**
So an evaluator can switch roles quickly during the demo. These are seeded local accounts, and the value lives only in the seed script and the sign-in helper — no real user is created with it.
**Q&A — Can the seed overwrite a changed password?**
No. `ON CONFLICT DO NOTHING` skips existing rows entirely, so a password changed through the reset flow survives re-seeding.

---

## 3. Backend

### 3.1 `server/src/config/env.ts`

**How it works.** Loads `.env` relative to the source file, then reads `DATABASE_URL`, `JWT_SECRET` and the rest into a frozen `env` object. Missing required values throw at boot with a message naming the variable and telling the operator to copy `.env.example`.

**Why this design.** Fail-fast configuration means a misconfigured server refuses to start rather than serving 500s later. Resolving `.env` relative to the file (not the cwd) is what lets `npm start` from `dist/` find the same file as `npm run dev`. The production guard rejects a JWT secret shorter than 32 characters, since a short secret is guessable.

**Q&A — Why crash on a missing environment variable instead of defaulting?**
A default for `DATABASE_URL` or `JWT_SECRET` would silently connect to the wrong database or sign tokens with a known key. Failing at boot makes the problem obvious in one line.
**Q&A — Are secrets committed to the repository?**
No. `.env` is git-ignored and only `.env.example` with placeholders is tracked. The JWT secret is generated per environment.

### 3.2 `server/src/utils/errors.ts`

**How it works.** Defines `AppError` with `statusCode`, machine-readable `code` and optional `details[]`, plus subclasses `ValidationError` (400), `UnauthorizedError` (401), `ForbiddenError` (403), `NotFoundError` (404) and `ConflictError` (409).

**Why this design.** Services throw domain errors and never touch the response object, which is what keeps business logic free of HTTP concerns. Because every expected failure is an `AppError`, the single error handler can serialise all of them identically, so the client always receives the same envelope shape.

**Q&A — Why custom error classes instead of returning error objects?**
Throwing unwinds to one handler, so a service deep in a call stack needs no plumbing to report a failure. It also makes it impossible to forget to check a return value.
**Q&A — How does the client tell a validation failure from a conflict?**
The HTTP status differs (400 vs 409) and the `error.code` differs (`VALIDATION_FAILED` vs `CONFLICT`), so the UI can react precisely instead of pattern-matching a message.

### 3.3 `server/src/utils/validators.ts`

**How it works.** Exports the password rule (`^(?=.*[a-z])(?=.*[A-Z])(?=.*[^a-zA-Z0-9]).{9,}$`), a function that returns **every** rule a password breaks, and Zod schemas for signup, login, forgot-password, reset-password and staff creation. `toFieldErrors()` flattens a `ZodError` into `{ field, message }` pairs.

**Why this design.** Reporting all broken rules at once is a UX decision: telling a user about the missing uppercase letter, then the special character, then the length, in three round trips, is hostile. `.strict()` on each schema rejects unknown keys, which is what turns a crafted `{"role":"ADMIN"}` signup into an explicit 400 rather than a silently ignored field. `describePasswordFailures` is also mirrored in the client checklist so the user sees the same rules live.

**Q&A — Why return every password violation instead of the first?**
A user typing a password that breaks three rules should learn all three at once. Sequential one-at-a-time errors would require three submissions for the same string.
**Q&A — Is the password regex the only defence?**
No. The regex/Zod layer gives the specific message, and the client checklist duplicates the rules for instant feedback. The server is authoritative: the client is a convenience, never a gate.

### 3.4 `server/src/utils/jwt.ts`

**How it works.** `signAuthToken` issues an HS256 token with `sub` = user id, `role`, `email`, an issuer of `brightloop` and an expiry from `JWT_EXPIRES_IN`. `verifyAuthToken` verifies signature, issuer and expiry, and converts `TokenExpiredError` into a distinct "session expired" message.

**Why this design.** The subject claim carries identity and the role claim is a hint, but the middleware re-reads the user from the database — so a role change or deactivation takes effect immediately rather than waiting for token expiry. Distinguishing "expired" from "invalid" lets the UI prompt a re-login instead of a generic failure.

**Q&A — If the token contains the role, why query the database again?**
Because a token is a snapshot. If an Admin demotes a staff member or deactivates an account, a stateless token would keep the old privilege until it expires; the reload makes revocation immediate.
**Q&A — Where does the signing secret come from?**
From `JWT_SECRET` in the git-ignored `.env`, generated per environment and rejected at boot in production if shorter than 32 characters.

### 3.5 `server/src/utils/logger.ts`, `server/src/utils/response.ts`

**How it works.** The logger emits one structured line per event at `info`/`warn`/`error`/`debug` and never logs request bodies or tokens. `sendSuccess()` writes the uniform `{ success: true, data, message? }` envelope.

**Why this design.** A single response helper means success shapes cannot drift between endpoints, which matters because the frontend parses one envelope everywhere. The logger's deliberate omissions are a security decision: auth logs are the most common place passwords and bearer tokens leak.

**Q&A — Why not use a logging library?**
The requirement is ten lines of formatted output; a dependency would add configuration surface for no benefit. The important property is what is *not* logged, and that is explicit here.
**Q&A — How do error responses stay consistent?**
Every route throws, and the global error handler is the only place that writes a failure envelope, so the shape is defined once.

### 3.6 `server/src/repositories/user.repository.ts`

**How it works.** The only module containing `users` SQL. Explicitly selects `PUBLIC_COLUMNS` (no hash, no reset token) or `PRIVATE_COLUMNS` for authentication paths. `findUserByEmail` compares with `LOWER()`, `insertUser` lowercases the email before writing, and `insertUser` accepts an optional `PoolClient` so it can join a caller's transaction.

**Why this design.** Naming the columns instead of `SELECT *` is the guard against a password hash accidentally serialising into an API response. The optional client parameter lets the service include the insert in a larger transaction without the repository knowing why.

**Q&A — How do you prevent `password_hash` leaking to the client?**
The repository exposes two projections, and only the authentication-specific queries request the private one. The public columns list has no hash and no reset token, so a JSON response cannot contain them.
**Q&A — Why pass a transaction client into a repository function?**
So the insert can commit atomically with an audit row. The repository stays transaction-agnostic — it uses whatever executor it is given.

### 3.7 `server/src/repositories/audit.repository.ts`

**How it works.** `recordAuditEvent()` inserts one row into `audit_logs`, optionally on a caller-supplied client.

**Why this design.** Audit writes are grouped in one module so every future action logs the same shape. Passing the transaction client means a staff creation and its audit entry are one atomic unit — there is no state where a staff member exists with no record of who created them.

**Q&A — What if the audit insert fails?**
Inside `createStaffMember` it runs in the same transaction, so the whole operation rolls back. That is deliberate for privileged actions: no silent success without an audit trail.
**Q&A — Why audit staff creation specifically?**
It is a privilege-granting action, which is exactly what an auditor looks for first. Later milestones record billing runs and payment edits the same way.

### 3.8 `server/src/services/auth.service.ts`

**How it works.** `signup` checks the email, hashes with bcrypt (cost from env), inserts as `CUSTOMER` — the role is never read from the request — and returns a session. `login` loads the user, rejects inactive accounts, compares the password, reloads the public projection and signs a token. `requestPasswordReset` generates 32 random bytes, stores the SHA-256 hash with a one-hour expiry, and returns the raw token only when the address exists. `resetPassword` hashes the presented token, looks it up with a live-expiry predicate, and clears the token after updating the hash.

**Why this design.** Three decisions carry the security story. First, the role is hard-coded to `CUSTOMER` on signup, so privilege escalation through the signup body is impossible by construction. Second, a dummy bcrypt comparison runs when the email is unknown, so response timing does not reveal which addresses are registered. Third, reset tokens are stored hashed and are single-use — the row is cleared on success, so a leaked database cannot be replayed against the reset endpoint.

**Q&A — Why hash the reset token in the database?**
So a database read cannot mint a password reset. The raw token exists only in the response and in the user's hands, exactly like a password.
**Q&A — How do you stop an attacker enumerating registered emails?**
Login returns the same "Incorrect email or password" for both cases and performs a dummy bcrypt comparison so the timing matches; forgot-password always returns the same message whether or not the address exists.

### 3.9 `server/src/services/user.service.ts`

**How it works.** `createStaffMember` re-checks that the caller is `ADMIN`, checks email availability, hashes the password, and inside one transaction inserts the user with role `STAFF` and writes a `STAFF_CREATED` audit row. `listAllUsers` returns the public projection.

**Why this design.** The role check is duplicated here even though the route already has `requireRole('ADMIN')`. That is defence in depth: a future route that forgets the middleware still cannot create staff, because the service refuses. The transaction guarantees the audit row and the account are created together.

**Q&A — Isn't checking the role twice redundant?**
It is deliberately redundant. Middleware protects the route; the service protects the business rule. If a new endpoint is added without the guard, the invariant still holds.
**Q&A — What status does a Staff user get when calling the staff-creation endpoint?**
403 Forbidden, with a message naming the required role and the caller's actual role. Verified end-to-end for both `STAFF` and `CUSTOMER` callers.

### 3.10 `server/src/middleware/auth.middleware.ts`

**How it works.** `authenticate` extracts the bearer token, verifies it, parses the numeric subject, reloads the user, rejects missing or inactive accounts, and attaches `{ id, role, email }` to `req.user`. `requireRole(...roles)` rejects with 403 when the caller's role is not in the allowed list.

**Why this design.** Reloading the user turns a stateless token into a revocable session: deactivating an account takes effect on the next request. `requireRole` is a factory so each route states its own policy inline, which makes the permission matrix auditable by reading the route file.

**Q&A — What happens with a valid token belonging to a deleted user?**
The reload returns no row and the request fails with 401 asking the user to sign in again. The signature alone is never treated as sufficient proof of an active account.
**Q&A — Can a `STAFF` token be edited to claim `ADMIN`?**
No. The token is signed with the server secret, so any change invalidates the signature. And even a forged role claim would be overwritten by the database reload.

### 3.11 `server/src/middleware/validate.middleware.ts`

**How it works.** `validateBody(schema)` parses `req.body` with Zod and replaces it with the parsed value on success, or forwards a `ValidationError` carrying every field error on failure. `asyncHandler` wraps async handlers so a rejected promise reaches the error handler instead of hanging the request.

**Why this design.** Replacing `req.body` with the parsed output means downstream code receives trimmed, typed data — a `"  priya@x.com  "` email arrives already trimmed. `asyncHandler` exists because Express 4 does not catch async rejections; without it, a thrown service error would leave the socket open until the client times out.

**Q&A — Why does validation replace the request body instead of just checking it?**
So every downstream reader gets the validated, normalised value. Nothing can accidentally read the raw, untrimmed input.
**Q&A — What does `asyncHandler` prevent?**
An unhandled promise rejection in a route. Express 4 only forwards synchronous throws, so without the wrapper the client would hang instead of receiving a 500.

### 3.12 `server/src/middleware/error.middleware.ts`

**How it works.** A 404 handler for unmatched routes, and an error handler that serialises `AppError` with its status and code, flattens `ZodError`, maps PostgreSQL SQLSTATE codes (`23505` duplicate → 409, `23503` foreign key → 409, `23514` check → 400, `23502` not-null → 400, `22P02` invalid format → 400), handles malformed JSON, and falls back to a 500 that never leaks internals in production.

**Why this design.** Driver errors contain table, column and constraint names — useful to an attacker, meaningless to a user. Translating them into domain messages keeps the client contract clean. Logging the SQLSTATE and constraint while returning only a friendly message preserves debuggability without disclosure.

**Q&A — Why not return the raw PostgreSQL error to the user?**
It leaks internal schema details and produces messages like `duplicate key value violates unique constraint "uq_users_email"` that a customer cannot act on. The mapped message says what happened in business terms.
**Q&A — How do you debug a 500 if the details are hidden?**
The full error and stack are logged server-side on every 500. In development the response also includes a `server` detail line; production omits it.

### 3.13 `server/src/routes/auth.routes.ts`

**How it works.** Five endpoints: `POST /signup` (201 with token and user), `POST /login` (200), `POST /forgot-password` (always the same message; returns the reset URL only outside production), `POST /reset-password` (200, token consumed), `GET /me` (authenticated profile).

**Why this design.** Each route is a thin composition of validate → service → respond, with no SQL and no branching logic of its own. The forgot-password route is deliberately indistinguishable between a registered and an unknown address, which is what prevents the endpoint being used as a customer-enumeration oracle.

**Q&A — Why does forgot-password return the reset link?**
Because no mail server is configured locally, and an evaluator must be able to complete the flow. The link is returned only when `NODE_ENV !== 'production'`; in production the response is the generic message alone.
**Q&A — What does `/auth/me` return and why is it needed?**
It returns the caller's profile resolved from the database, and the client calls it on load to restore a session from a stored token while confirming the account is still active.

### 3.14 `server/src/routes/admin.routes.ts`

**How it works.** Mounts `authenticate` for the whole router, then `POST /users/staff` behind `requireRole('ADMIN')` and `GET /users` behind `requireRole('ADMIN','STAFF')`.

**Why this design.** The router-level `authenticate` means a new admin endpoint cannot accidentally be public — the author has to actively add a more permissive role list. This is the route that the brief designates as the single staff-creation gate.

**Q&A — How is "only Admin can add staff" enforced?**
By `requireRole('ADMIN')` on the route plus a role assertion in `createStaffMember`. A `STAFF` or `CUSTOMER` caller receives 403 and no row is written; both cases were verified against a live database.
**Q&A — Why can Staff list users but not create them?**
Staff need to look up customers to build quotations, but hiring is an administrative act. The permission matrix in the brief separates read access from account provisioning.

### 3.15 `server/src/routes/index.ts`, `server/src/app.ts`, `server/src/index.ts`

**How it works.** `/api/v1/health` reports API and database status. The app applies `helmet`, a CORS allow-list, a 100 kB JSON body limit, request logging, the router, then the 404 and error handlers. `index.ts` listens first, then probes the database in the background, and installs `SIGINT`/`SIGTERM` handlers that drain the server and close the pool.

**Why this design.** Middleware order is the design: security headers, then origin control, then parsing, then routing, then errors — reversed anywhere and the error handler would not see them. Listening before probing means a database outage yields a clear `503 DATABASE_UNAVAILABLE` from `/health` rather than an API that never starts.

**Q&A — Why does the API start even when PostgreSQL is down?**
So `/health` can explain the problem. A server that refuses to boot gives the operator only a stack trace, and the frontend gets a connection error with no diagnosis.
**Q&A — Why is the JSON body limited to 100 kB?**
Authentication payloads are tiny. A limit makes an accidental or malicious large body cheap to reject before it is parsed into memory.

---

## 4. Frontend

### 4.1 `client/src/lib/api.ts`

**How it works.** One `apiRequest()` wrapper: builds the URL from `VITE_API_BASE_URL` (default `/api/v1`), adds JSON and bearer headers, aborts after 15 seconds, and normalises every outcome into `ApiResult` or an `ApiError` carrying `status`, `code` and `details`. `ApiError.fieldErrors()` maps details to a `{ field: message }` object, joining multiple rules for the same field.

**Why this design.** Centralising fetch means token handling, timeout behaviour and error shape exist once. Joining multiple messages per field is what lets a password that breaks three rules display all three under the input instead of only the last one. Network failure and timeout get distinct, actionable messages rather than "Failed to fetch".

**Q&A — Why not use axios?**
The native `fetch` API is sufficient here, and avoiding a dependency keeps the bundle smaller and the rubric's minimal-dependency requirement intact. The wrapper already provides what axios would: base URL, headers, timeout and error normalisation.
**Q&A — How does the UI distinguish a 409 duplicate email from a 401 bad password?**
`ApiError` exposes both the HTTP status and the server's machine-readable `code`, so components branch on `status`/`code` rather than parsing message text.

### 4.2 `client/src/lib/auth-context.tsx`

**How it works.** Holds `user`, `token` and `isBootstrapping`. On mount it reads the token from `localStorage`, calls `/auth/me`, and either restores the session or clears a 401. `login`, `signup` and `logout` update state and storage together.

**Why this design.** A single provider means every screen reads the same identity, so there is no "role in one component, different role in another" drift. The bootstrap step is why a page refresh does not log the user out. Storage access is wrapped in `try/catch` because `localStorage` throws in private browsing.

**Q&A — Why verify the token with `/auth/me` instead of decoding the JWT in the browser?**
Decoding would trust data the browser can edit and would not reveal a deactivated account. `/auth/me` returns the authoritative, current state from PostgreSQL.
**Q&A — Where is the token stored, and is that acceptable?**
In `localStorage`, so a refresh survives the session. That is acceptable for this local evaluation build; a production deployment would prefer an httpOnly cookie to reduce XSS exposure.

### 4.3 `client/src/components/layout/*`

**How it works.** `AuthLayout` renders a brand panel and a form card. `ProtectedRoute` shows a spinner while the session is being restored, redirects to `/login` when there is no user, and `PublicOnlyRoute` keeps signed-in users out of the auth screens. `AppShell` and `Header` render the brand, the user's name and email, the persistent role badge, and sign-out.

**Why this design.** The spinner-before-redirect detail is what makes refresh work: redirecting immediately would bounce an authenticated user to login during the brief window before `/auth/me` resolves. The role badge is permanently visible because the demo has to make RBAC observable — an evaluator should never have to guess which role is active.

**Q&A — Why does the protected route not redirect straight away?**
Because session restoration is asynchronous. Redirecting before `/auth/me` returns would log out a valid user on every refresh.
**Q&A — Can the role badge be trusted as a security control?**
No, and it is not one. It is a visual indicator; enforcement happens in `requireRole` on the server, and the badge only reflects what the API returned.

### 4.4 `client/src/pages/auth/*.tsx`

**How it works.** `LoginPage` validates presence, calls `login`, maps field errors under the inputs, and offers one-click demo accounts. `SignupPage` collects name, email, optional company and phone, password and confirmation, with the live checklist and a client-side match check. `ForgotPasswordPage` posts the email and, in development, renders the returned reset link. `ResetPasswordPage` reads `?token=` from the URL, validates confirmation, posts the new password, and shows a success state.

**Why this design.** Every form surfaces the server's specific message rather than a generic failure, which is the rubric's "clear, specific error messages" requirement. The checklist mirrors the server rule set so the user gets guidance while typing, and the confirm-password check runs on the client to avoid a pointless round trip.

**Q&A — If the client validates the password, why does the server validate it again?**
The client check is a convenience; the server check is the control. Anything can post to the API directly, so the rule must be enforced where the data is written.
**Q&A — What does the signup screen do about the role?**
It sends no role at all. The server assigns `CUSTOMER`, and a request that tries to send `role: "ADMIN"` is rejected with a 400 by the strict schema.

### 4.5 `client/src/pages/DashboardPage.tsx`

**How it works.** Reads the authenticated user from context and renders their role, a summary of what that role may do, their account details from the live `/auth/me` record, and the four foundation capabilities delivered in this milestone.

**Why this design.** The dashboard deliberately shows only data that actually exists in the database. It is a landing surface for the authenticated session, not a mock of the Finance dashboard, which belongs to Milestone 6 — showing invented metrics here would be exactly the static-data anti-pattern the rubric forbids.

**Q&A — Why is there no revenue or subscription data on this screen yet?**
Because those aggregates belong to Milestone 6 and to real invoice rows. The page shows account data read live from PostgreSQL and nothing fabricated.
**Q&A — How does the dashboard change per role?**
It reads `user.role` from the session and renders the capability summary for that role, which comes from the same server-resolved profile rather than a client constant.

### 4.6 `client/tailwind.config.js`, `client/src/index.css`

**How it works.** Defines the Odoo palette (plum `#714B67`, teal `#017E84`, ink `#2D3748`, surface `#F8FAFC`), the Inter font stack, a card shadow, and component classes (`.card`, `.btn-primary`, `.field-input`, `.field-label`, `.field-input-invalid`) that all forms share.

**Why this design.** Centralising the palette means a colour decision is made once, and every screen is consistent by construction rather than by discipline. The invalid-input class pairs a red border with a red focus ring so an error state stays visible while the field is focused.

**Q&A — Why Tailwind instead of a component library?**
Tailwind gives the specific Odoo-enterprise look the brief asks for without shipping a large library, and it keeps the CSS bundle at roughly 23 kB. Shared classes live in `@layer components`, so consistency is enforced without a dependency.
**Q&A — How is accessibility handled in the forms?**
Inputs receive `aria-invalid` and `aria-describedby` pointing at the error or hint element, errors are rendered in text next to the field, and a global `:focus-visible` ring makes keyboard focus visible.

---

## 5. Verification evidence

| Check | Result |
| :--- | :--- |
| `server npm run build` (`tsc`) | Exit 0 |
| `client npm run build` (`tsc` + `vite`) | Exit 0, bundle 197 kB (62 kB gzip) |
| `npm run db:init` on clean database | 14 tables, 43 indexes |
| `npm run db:init` a second time | No errors, identical counts |
| `npm run db:seed` a second time | No duplicates, 3 users |
| Weak password signup | 400, both broken rules listed |
| Invalid email signup | 400, specific message |
| Duplicate email (different case) | 409, exact required message |
| `role: "ADMIN"` in signup body | 400, escalation refused |
| Login with wrong password | 401, generic message |
| `STAFF` → create staff | 403 `FORBIDDEN` |
| `CUSTOMER` → list users | 403 `FORBIDDEN` |
| `ADMIN` → create staff | 201, `STAFF_CREATED` audit row written |
| Invalid token → `/auth/me` | 401 |
| Forgot password → reset → login | 200, new password works, old token rejected (400) |
| Database stores reset token as hash | Stored value ≠ raw token, 64 chars |
| `/health` with database down | 503 with actionable message |
| Vite dev server + `/api` proxy | 200 |

**Verification note:** schema, seed and the full auth/RBAC flow were exercised against a disposable PostgreSQL 18 cluster on port 5433. The repository's own `.env` points at the participant's local instance, which is configured with `npm run db:setup`.

---

## 6. Deliberate boundaries at the end of Milestone 1

Everything below is intentionally absent and belongs to a later milestone; nothing here is stubbed with static data.

- Products, variants, plans and quotation templates — delivered in Milestone 2 (sections 7–13).
- Subscription state machine and customer portal — Milestone 3.
- Tax/discount engines and the billing run — Milestone 4.
- Payments and invoice reconciliation — Milestone 5.
- Finance dashboard and performance seeding — Milestone 6.

---

## Milestone 2 — Catalog, Subscription Plans & Quotation Templates

**Commit scope:** catalogue uniqueness and surcharge constraints, three catalog repositories, three services, three route modules, the extended seed, a DATE type parser, seven new UI primitives, a sidebar-based application shell, and the Products, Plans and Quotation templates screens.
**Verified:** both workspaces compile (`tsc`), the client bundles (247 kB), the schema and seed apply twice in a row with identical row counts, and **61 of 61** live API assertions pass against a freshly created PostgreSQL 18 cluster — including AC2.1 (Brand = Odoo, +560 → $1,760), AC2.2 (lifecycle flags persist) and AC2.3 (a template reproduces its exact products, quantities and prices).

### Repository additions

```
server/src/utils/catalog.validators.ts     zod schemas for products, variants, plans, templates
server/src/utils/params.ts                 :id route-parameter parsing
server/src/utils/money.ts                  NUMERIC text -> JSON number
server/src/repositories/update-builder.ts  PATCH object -> SET clause via a column whitelist
server/src/repositories/product.repository.ts
server/src/repositories/plan.repository.ts
server/src/repositories/template.repository.ts
server/src/services/product.service.ts
server/src/services/plan.service.ts
server/src/services/template.service.ts
server/src/services/requester.ts           shared { id, role } request identity
server/src/routes/product.routes.ts
server/src/routes/plan.routes.ts
server/src/routes/template.routes.ts
client/src/lib/                             format, navigation, plan-flags, use-api-resource
client/src/components/ui/                   Modal, Switch, Badge, SelectField, TextAreaField,
                                            PageHeader, EmptyState, IconButton
client/src/components/layout/               Sidebar, RoleRoute
client/src/components/catalog/              ProductFormModal, VariantFormModal,
                                            PlanFormModal, TemplateFormModal
client/src/pages/                           ProductsPage, PlansPage, TemplatesPage
```

---

## 7. Database schema — Milestone 2 additions

### 7.1 `uq_products_name`, `uq_plans_name`, `uq_templates_name`

**How it works.** `products.name`, `subscription_plans.name` and `quotation_templates.name` now carry `UNIQUE` constraints. The API also performs a case-insensitive lookup (`WHERE LOWER(name) = LOWER($1)`) before inserting, so a duplicate is reported as a friendly 409 naming the clashing item rather than as a raw constraint violation.

**Why this design.** Names are how staff and customers refer to these records — a second "Monthly Pro" is never what the user meant, and it would make every later dropdown ambiguous. The database constraint is the real guarantee (two simultaneous requests cannot both pass the application check); the case-insensitive query exists only so the message is useful, because `UNIQUE` itself is case-sensitive.

**Q&A — Why keep the constraint if the service already checks for a duplicate?**
Because the service check is a race-prone convenience, not a guarantee. The unique constraint is what makes the duplicate impossible, while the pre-check turns the most common failure into a specific message with the conflicting name.
**Q&A — Is the name case-insensitive uniqueness enforced in the database?**
Strictly speaking no — `UNIQUE (name)` treats `Monthly Pro` and `monthly pro` as different. The service rejects the case-insensitive duplicate and the audit trail records it; a functional unique index on `LOWER(name)` can be added later without a data change.

### 7.2 `chk_variant_price_extra`

**How it works.** `product_variants.price_extra` gains `CHECK (price_extra >= 0)`, so a variant can only raise a product's price, never silently discount it.

**Why this design.** The brief defines a variant as a positive surcharge (Brand = Odoo, +560). A negative surcharge would be a discount rule in disguise, bypassing the Admin-only discount engine that Scene 5 makes the single place discounts are authored. The Zod schema rejects negatives too, so the user gets `Price extra cannot be negative.` while the database stands guard behind it.

**Q&A — Why forbid a negative `price_extra` rather than reject it in the UI only?**
Because a variant is by definition an uplift, and allowing a negative value would let anyone with the Admin screen create discounts outside the discount-rules module. The check keeps that single-source-of-truth intact at the storage layer.
**Q&A — What does a variant cost when its surcharge is zero?**
The line price is exactly the product's `sales_price`. The seeded `Brand: Brightloop` variant uses 0 so the ERP licence can be offered at its $1,200 base price.

### 7.3 Guarded upgrade blocks for pre-existing databases

**How it works.** Each new constraint is also added through a `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ...) ... END $$;` block placed after the `CREATE TABLE IF NOT EXISTS`. On a fresh database the constraint already exists inside the table definition and the block is a no-op; on a Milestone 1 database the table is skipped by `IF NOT EXISTS`, so the block is what actually applies the constraint.

**Why this design.** `CREATE TABLE IF NOT EXISTS` silently skips an existing table — including every constraint inside it. Without the guarded `ALTER`, a participant who ran the Milestone 1 schema would keep running against tables that never gained the new rules, and the failure would only appear later as a duplicate row nobody expected. The guard makes one schema file correct for both audiences.

**Q&A — Why not drop and recreate the tables to apply new constraints?**
Because the database now holds real seed and evaluation data. Dropping tables would destroy it, and making the schema script destructive would make `db:init` unsafe to re-run — the opposite of the idempotency every evaluator will test.
**Q&A — How do you know the upgrade block actually ran?**
`db:init` reports the table and index counts after applying the file (14 tables, 46 indexes), and the verification run applied the schema to a Milestone 1 database and then to a fresh one, with identical counts both times.

---

## 8. Database tooling

### 8.1 `server/src/db/pool.ts` — the DATE type parser

**How it works.** Alongside the `pg.Pool` singleton, the module registers `pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value)`, so a `DATE` column arrives in JavaScript as the literal `'YYYY-MM-DD'` text PostgreSQL sent rather than as a `Date` at local midnight.

**Why this design.** Node parses a `DATE` into a `Date` at midnight **local time**; serialising that to UTC moves the day backwards or forwards depending on the machine's offset. On an IST machine, `2026-01-01` would arrive as `2025-12-31T18:30:00Z` and the plan's availability window would be off by one day. Returning the raw text removes an entire class of timezone bugs from every plan and subscription date, and the UI formats it with a UTC-anchored helper.

**Q&A — Why not just call `.toISOString().slice(0, 10)` on the value?**
Because by then the shift has already happened: an IST machine has already turned `2026-01-01` into a `Date` for 2025-12-31 in UTC. The parser has to intervene before `pg` builds the `Date`.
**Q&A — Does this affect `TIMESTAMPTZ` columns?**
No. Timestamps are genuine instants and are still parsed to `Date` objects and returned as ISO strings; only `DATE` — a calendar day with no time — is handled as text.

### 8.2 `server/src/db/seed.ts` — catalogue, plans and templates

**How it works.** Three data tables drive the seed. `ensureProduct` selects by name and inserts only when missing, then inserts each variant with `ON CONFLICT (product_id, attribute_name, attribute_value) DO NOTHING`. `ensurePlan` inserts with `ON CONFLICT (name) DO NOTHING`. `ensureTemplate` returns early if the template exists, otherwise resolves each line's product and variant to an id, computes `sales_price + price_extra`, and inserts the header plus all lines inside one transaction. The run ends with a SQL count of users, products, variants, plans, templates and template lines.

**Why this design.** A seed that re-runs must not duplicate or rewrite rows: the `SELECT`-then-`INSERT` in `ensureProduct` is deliberately not an upsert, because an upsert would bump `updated_at` on every run even when nothing changed. Template lines are seeded with the same `sales_price + price_extra` rule the API uses, so the seeded "Enterprise Monthly Starter" shows $1,760 for the Odoo ERP line — the acceptance criterion is visible in the seeded data, not only in a fresh request.

**Q&A — Why is the seed not a single `TRUNCATE` followed by inserts?**
Because the evaluator, and the participant, will run `db:setup` repeatedly. Truncating would wipe accounts and any invoices created during the demo. Every step is additive and idempotent instead.
**Q&A — Why compute the template line price in the seed rather than hard-code 1760?**
So the seeded data proves the pricing rule rather than restating its output. If a product price changed, the seed would follow it, exactly as a live quotation would.

---

## 9. Validation and small utilities

### 9.1 `server/src/utils/catalog.validators.ts`

**How it works.** Exports `PRODUCT_TYPES`, `BILLING_INTERVALS` and seven schemas (`createProductSchema`, `updateProductSchema`, `createVariantSchema`, `createPlanSchema`, `updatePlanSchema`, `createTemplateSchema`, plus inferred input types). Every schema is `.strict()`, so an unexpected key is an error rather than a silent drop. Shared field builders enforce business bounds: `moneyField` rejects negatives, values above the `NUMERIC(12,2)` ceiling, and more than two decimal places; `dateField` rejects both bad formats and impossible dates such as `2026-02-30`; `quantityField` requires a positive whole number; `updatePlanSchema` and `updateProductSchema` require at least one key. `createPlanSchema` cross-checks `availableTo >= availableFrom`.

**Why this design.** Every message is written for the person filling the form — `Price extra cannot be negative.`, `Product type must be Software, Service or Add-on.` — because the rubric scores clear, specific errors. `.strict()` matters for role safety: a signup-style body that tries to smuggle `isActive` or an `id` is rejected instead of being quietly ignored. The money and date helpers are shared builders, so one rule change applies to every field that uses them.

**Q&A — Why does `updateProductSchema` allow `isActive` when `createProductSchema` forbids it?**
Because items are always created active; retiring and restoring are updates. Exposing it on create would invite a client to insert an already-invisible product, which no workflow needs.
**Q&A — Where is the cross-field date check for a partial plan update?**
In `plan.service.ts`, not in the Zod schema, because a PATCH may send only one of the two dates. The service merges the patch onto the stored row before comparing, which a request-level schema cannot do.

### 9.2 `server/src/utils/params.ts`

**How it works.** `parsePositiveIntParam(raw, label)` converts an Express `:id` string to an integer and throws a `ValidationError` with a `{ field: 'id' }` detail when the value is missing, empty, non-numeric or not positive.

**Why this design.** Express hands path parameters over as text, and PostgreSQL would answer `GET /products/abc` with SQLSTATE `22P02` — a message about invalid input syntax for type integer. Failing before the query gives the client the same `VALIDATION_FAILED` envelope and field detail the rest of the API uses, and stops the invalid value reaching the database at all.

**Q&A — Why is a non-numeric id a 400 rather than a 404?**
Because the request itself is malformed — `/products/abc` cannot name any resource. The 404 is reserved for a well-formed id that does not exist, which the verification script also covers (`/products/999999`).
**Q&A — Why return `field: 'id'` instead of the parameter's real name?**
The UI groups errors by input name, and every route parameter is presented as an identifier; one consistent key keeps the client mapping simple.

### 9.3 `server/src/utils/money.ts`

**How it works.** `toAmount(value)` converts the text `pg` returns for `NUMERIC` into a JSON number rounded to two decimal places, returning 0 for `null`, `undefined` or a non-finite value.

**Why this design.** `pg` returns `NUMERIC` as a string on purpose, to avoid IEEE-754 rounding of arbitrary precision. Our values are bounded by `NUMERIC(12,2)` — well inside the range where a double represents two-decimal amounts exactly — so returning a number is safe and gives the React layer `1200` instead of `"1200.00"`. It is applied once, at the service boundary, so no component has to remember the conversion.

**Q&A — Why not configure `pg` to parse `NUMERIC` as a float globally?**
That parser would also affect future aggregate columns, where a large sum should be handled deliberately rather than silently coerced. Keeping the conversion explicit at the DTO boundary leaves that decision in one visible place.
**Q&A — Why does the function round instead of trusting the database?**
Arithmetic such as base price plus variant surcharge happens in JavaScript before being returned. Rounding to paise at the boundary guarantees the response never carries `1759.9999999999998`.

### 9.4 `server/src/repositories/update-builder.ts`

**How it works.** `buildUpdateSet(changes, columns)` walks the keys of a patch object, skips `undefined`, maps the API field name to a physical column through a repository-declared whitelist, and returns `{ clause, values }` — for example `name = $1, price = $2`. An unmapped key throws, and an empty patch throws as well.

**Why this design.** Three modules now need partial updates, and hand-building `SET` strings in each is how SQL injection and "updated a column nobody meant to update" bugs enter a codebase. The column name always comes from a constant map in the repository; the request supplies only values, which are parameterised. Skipping `undefined` is what lets one PATCH schema serve "change the price" and "flip one flag".

**Q&A — How does this prevent SQL injection through a field name?**
Field names are never interpolated from the request. `Object.keys(changes)` is matched against a fixed `Record` of known keys, and only the mapped, trusted column string reaches the SQL.
**Q&A — What happens if a caller passes a key with no column mapping?**
It throws immediately rather than ignoring it, so a typo in a service is caught in development instead of producing an update that silently did nothing.

---

## 10. Repositories — SQL only

### 10.1 `server/src/repositories/product.repository.ts`

**How it works.** Typed row interfaces (`ProductRow`, `VariantRow`) with `NUMERIC` fields declared as `string`; `listProducts(activeOnly)`, `findProductById`, `findProductByName` (case-insensitive), `insertProduct`, `updateProduct` (through `buildUpdateSet`), `listVariantsForProducts(ids)` using `product_id = ANY($1::int[])`, `findVariantById`, `findVariantByAttributes` and `deleteVariant`. Every function accepts an optional `PoolClient` so it can join a caller's transaction.

**Why this design.** `listVariantsForProducts` is the reason the products page costs two queries rather than one per product: the service fetches all products, then all variants in a single round trip and groups them in memory. Accepting an optional client keeps the transaction boundary in the service — the repository never decides what belongs in a transaction, it just participates in one when asked.

**Q&A — Why does `sales_price` appear as a string in the row type?**
Because that is exactly what `pg` returns for `NUMERIC`, and declaring it honestly forces the service to convert it deliberately via `toAmount` instead of forgetting. The alternative — a cast that lies about the runtime type — hides the conversion.
**Q&A — Could `listVariantsForProducts` become slow with a large catalogue?**
No: it filters on `product_id = ANY(...)`, which uses `idx_variants_product`, and the id list is bounded by the page it serves. It also short-circuits to an empty array when given no ids, avoiding a pointless round trip.

### 10.2 `server/src/repositories/plan.repository.ts`

**How it works.** `listPlans(customersOnly)` orders by `is_active DESC, price ASC, name ASC`; when the flag is set it adds `is_active = TRUE AND available_from <= CURRENT_DATE AND (available_to IS NULL OR available_to >= CURRENT_DATE)`. Also `findPlanById`, `findPlanByName`, `insertPlan` and `updatePlan`. `available_from` / `available_to` are typed `string` / `string | null` because of the DATE parser.

**Why this design.** The customer filter is a SQL predicate rather than a JavaScript filter so unavailable plans never leave the database, and so the `is_active` / interval index can do its job. `CURRENT_DATE` is evaluated by PostgreSQL in the server's timezone, which is the same clock the rest of the availability logic uses — doing it in Node would reintroduce the timezone question.

**Q&A — Why does the customer query not simply filter in the service?**
Because a filter in the service still transfers every plan, including retired ones, to the API process. Pushing it into the `WHERE` clause keeps the response small and makes the rule impossible to bypass by adding a new endpoint that forgets it.
**Q&A — What does an admin see that a customer does not?**
Retired plans, and plans whose availability window is in the future or has ended — the admin needs to see them to edit or restore them; the customer only sees what can be bought today.

### 10.3 `server/src/repositories/template.repository.ts`

**How it works.** Template queries join `subscription_plans` so `plan_name` and `plan_billing_interval` come back with the header; line queries join `products` and `LEFT JOIN product_variants` so each line carries `product_name`, `variant_attribute_name` and `variant_attribute_value`. `listLinesForTemplates(ids)` fetches every line for a page of templates in one `ANY(...)` query. `insertTemplateLines` writes all lines with a single multi-row `INSERT`.

**Why this design.** A template screen shows a header with its plan and a table of lines with product names — resolving those in SQL means the client never has to join three collections itself. The `LEFT JOIN` is what makes an optional variant free rather than a second query per line. The multi-row insert keeps a 50-line template to one round trip inside the same transaction as its header.

**Q&A — Why is the plan joined into the template query instead of fetched over HTTP by id?**
Because the client renders a list of templates; a second request per template would be N+1 over the network. Joining is one indexed lookup and gives the UI everything it displays.
**Q&A — How are the lines kept consistent if the header insert succeeds and the line insert fails?**
Both run inside the service's `withTransaction`, so a failed line insert rolls the header back too. A template with zero lines is therefore never stored.

---

## 11. Services — business rules only

### 11.1 `server/src/services/product.service.ts`

**How it works.** Maps rows to DTOs (`toProductDto`, `toVariantDto`) where each variant reports both its `priceExtra` and its effective `price` (base + extra). `listProducts` shows a customer only active products; `getProduct` returns 404 for a retired product to a customer. `createProduct` / `updateProduct` / `deactivateProduct` / `addVariant` / `removeVariant` each assert `ADMIN`, reject case-insensitive duplicates with a 409, and write an audit event in the same transaction. `resolvePricedLine(productId, variantId)` validates that the product exists and is active and that the variant belongs to it, then returns `unitPrice = salesPrice + priceExtra`.

**Why this design.** `resolvePricedLine` is the single implementation of the Odoo rule (AC2.1): a template line, and later a subscription line, cannot compute the price a different way. Retiring a product rather than deleting it is deliberate — once a product appears on an invoice, `ON DELETE RESTRICT` would refuse the delete anyway, and relaxing the key would rewrite history. The DTO carries `price` next to `priceExtra` so the UI never repeats the arithmetic in a second place.

**Q&A — Why is the effective price computed on the server when the client could add the two numbers?**
Because the price that gets billed must be decided where the data is written, not where it is displayed. The client reuses numbers the server already produced; the server is authoritative.
**Q&A — Why does deleting a product not remove the row?**
Historical invoices and subscriptions reference it under `RESTRICT`. Deactivating keeps every past document explainable while hiding the product from new work, and the same endpoint restores it.

### 11.2 `server/src/services/plan.service.ts`

**How it works.** `createPlan` asserts `ADMIN`, rejects duplicate names, then inserts with defaults `autoClose = false`, `allowEarlyClose = true`, `allowPause = true`, `allowRenew = true` and `minQuantity = 1`, and writes a `PLAN_CREATED` audit row. `updatePlan` merges the incoming partial patch with the stored row **before** re-checking the availability window, rebuilds an explicit patch and writes `PLAN_UPDATED`. `deactivatePlan` retires the plan. `listPlans` narrows to active-and-available plans for a customer.

**Why this design.** The merged-window check is the subtle part: a PATCH that sends only `availableTo` must still be compared against the stored `availableFrom`, otherwise an impossible window could be created one field at a time. Defaults are stated in the service *and* in the schema so an API create and a direct SQL insert agree.

**Q&A — Why can the flag toggles be a single-key PATCH?**
Because each card control changes exactly one flag, and `updatePlanSchema` accepts any non-empty subset. Sending one key keeps the request honest about what changed and avoids overwriting fields another admin edited meanwhile.
**Q&A — What does retiring a plan do to existing subscriptions?**
Nothing — the subscription keeps its plan reference and its terms. Retirement only stops the plan being offered for new quotations, which is why the endpoint is a status change rather than a delete.

### 11.3 `server/src/services/template.service.ts`

**How it works.** `assertInternal` limits reads to `ADMIN` and `STAFF`; `createTemplate` additionally requires `ADMIN`. It rejects duplicate names (409), requires an existing **active** plan, rejects the same `(product, variant)` appearing on two lines, and resolves every line through `resolvePricedLine` — which both validates ownership of the variant and yields the server-side default price when the client omits `unitPrice`. Header and lines are inserted in one transaction with a `TEMPLATE_CREATED` audit row, then the template is reloaded and returned with `lineCount` and `totalValue`.

**Why this design.** The template is the acceptance criterion for pre-fill (AC2.3), so its price must be reproducible even if the client posts stale numbers — which is why `unitPrice` is optional and server-filled. Rejecting duplicate product lines keeps "quantity 2" and "quantity 3" from silently becoming two rows that mean five; the UI shows the same message before submitting. `withLines` costs exactly two queries regardless of how many templates are listed.

**Q&A — If a client sends an explicit `unitPrice`, can it undercut the catalogue price?**
It can, intentionally: `unitPrice` is a negotiated offer, which is why the column exists on the template line. The server only fills it when it is omitted, and the value is validated as a non-negative amount with two decimals.
**Q&A — Why can Staff read templates but not create them?**
Staff use templates to build quotations, which is their daily work; authoring what the company offers is reserved for Admin, matching the brief's permission split (the same split as discount rules).

---

## 12. Routes

### 12.1 `server/src/routes/product.routes.ts`, `plan.routes.ts`, `template.routes.ts`

**How it works.** Each router applies `authenticate` once at the router level. Products: `GET /`, `GET /:id` for any signed-in user; `POST /`, `PATCH /:id`, `DELETE /:id`, `POST /:id/variants`, `DELETE /:id/variants/:variantId` behind `requireRole('ADMIN')`. Plans: the same shape, with `PATCH /:id` documented as the flag toggle used by the plan cards. Templates: `GET /` and `GET /:id` for `ADMIN`/`STAFF`, `POST /` for `ADMIN`. Every write validates its body with the matching Zod schema before the service runs, and every route parses its id with `parsePositiveIntParam`. `routes/index.ts` mounts them at `/products`, `/plans` and `/quotation-templates`.

**Why this design.** The router-level `authenticate` means a new endpoint inside these modules is authenticated by default — forgetting a role check yields "any signed-in user", not "the public". Validation sits in the route layer, so an invalid body never reaches a service and never opens a transaction.

**Q&A — Why does the customer portal need `GET /products` at all if templates are internal?**
Because a customer must see what their subscription contains and what add-ons they may switch on. The endpoint is authenticated and returns only active products, so retired catalogue items stay invisible.
**Q&A — Are the role checks here the only enforcement?**
No. Each service repeats the assertion, and the sidebar and `RoleRoute` hide the screens. The route check produces the 403 an attacker sees; the service check means a future route that forgets it still cannot write.

---

## 13. Frontend

### 13.1 New UI primitives — `client/src/components/ui/`

**How it works.** `Modal` renders through `createPortal` to `document.body`, closes on Escape and on a backdrop click (the overlay compares `event.target` to `currentTarget`, so a click inside the panel never dismisses the form), locks body scroll while open, and focuses the first field. `Switch` is a `role="switch"` button with `aria-checked`, a busy state and a keyboard-focus ring. `Badge` provides six tones used for product types, plan state and flags. `SelectField`, `TextAreaField`, `TextField` share the same label / error / hint contract as the existing fields. `PageHeader` pairs a title with a one-line description and an optional action. `EmptyState` turns emptiness into a next step. `IconButton` gives icon-only actions an accessible name.

**Why this design.** Every catalog form needed a dialog, and hand-rolling one per screen would have produced four different Escape behaviours. The `event.target === event.currentTarget` comparison is the detail that makes a dialog usable: with a plain `onClick` on the overlay, a drag-select that ends outside the text field closes the form and discards the user's work.

**Q&A — Why render the modal in a portal instead of inside the page?**
Because the page's containers establish stacking and overflow contexts; a form inside one of them would clip or sit under the sticky header. A portal to `document.body` guarantees the dialog sits above everything.
**Q&A — How is the switch accessible without a checkbox?**
It is a `<button role="switch">` with `aria-checked` and a descriptive `aria-label` such as "Allow pause for Monthly Pro", so a screen reader announces both the state and what it controls, and `aria-busy` while the PATCH is in flight.

### 13.2 Shell and navigation — `Sidebar`, `AppShell`, `Header`, `RoleRoute`, `lib/navigation.ts`

**How it works.** `NAV_ITEMS` lists each screen with its path, label, icon and permitted roles; `navItemsForRole` filters it for the sidebar and the same list documents what `RoleRoute` protects. `Sidebar` renders a sticky plum rail on desktop and, below `lg`, a drawer that is mounted only while open with an explicit close button. `AppShell` composes sidebar, header and a `max-w-6xl` main column. `RoleRoute` redirects a role without access to `/`. `titleForPath` supplies the header's page title.

**Why this design.** A single navigation list removes the classic bug where a screen is reachable from the menu but not guarded, or guarded but invisible. Rendering the mobile drawer only while open avoids the alternative — keeping invisible links in the tab order — which is why the earlier `inert` approach was dropped: React 18 typings do not expose that attribute, and a drawer that is not in the DOM cannot be tabbed into.

**Q&A — Is hiding the link a security control?**
No, it is guidance. `RoleRoute` keeps a customer out of `/templates`, and `requireRole` on the server is the actual control; the sidebar only stops people from being offered a screen that would refuse them.
**Q&A — Why a sticky sidebar rather than a top nav bar?**
The catalogue is now four working areas plus the dashboard, and the brief asks for intuitive navigation with a persistent role indicator. A vertical rail keeps every destination one click away while the header carries identity and sign-out.

### 13.3 Catalog forms — `ProductFormModal`, `VariantFormModal`, `PlanFormModal`, `TemplateFormModal`

**How it works.** Each modal owns its fields, validates locally with the same rules the server applies, submits through `apiRequest`, and maps `ApiError.fieldErrors()` back onto the inputs. `VariantFormModal` shows a live preview panel: product price, the variant surcharge and the resulting effective price — $1,200 + $560 = $1,760 for the Odoo brand. `PlanFormModal` carries the four lifecycle switches and the availability dates. `TemplateFormModal` manages a list of draft lines, prefills a line's unit price from `salesPrice + priceExtra` when a product or variant is chosen, rejects duplicate product/variant pairs before submitting, and shows the running template total in the footer. `ProductsPage` adds client-side search across names, types, notes and variant labels.

**Why this design.** The preview panel is the acceptance criterion made visible: an evaluator can watch the +560 rule apply before saving. Prefilling the unit price from the same arithmetic keeps the form honest — the server still fills it if omitted, so a stale client cannot corrupt it. Duplicate-line detection on the client mirrors the 400 the server returns, turning a failed request into instant guidance.

**Q&A — If the client validates, why does the server validate again?**
The client check is for speed and clarity; the server check is the control, because anything can post directly to the API. The two rules are written to match so a valid form is never rejected by a surprise server rule.
**Q&A — Why does the template form send `unitPrice` only when the user typed one?**
So the server applies the catalogue rule by default. Omitting the field is how the form says "use the list price"; sending it is an explicit negotiated override.

### 13.4 Pages — `ProductsPage`, `PlansPage`, `TemplatesPage`

**How it works.** All three load through `useApiResource(path)` and update their local list from the object each mutation returns, so no refetch is needed. `ProductsPage` renders a searchable ledger: product name and type badge, sales and cost price, notes, and each variant with its `+extra` and effective price, plus add-variant, edit, retire and restore for Admin. `PlansPage` renders plan cards with a colour-coded interval rail (teal for daily/weekly, plum for monthly/yearly), the price in tabular numerals, a "minimum N" line, the availability window, one `Switch` per lifecycle flag that PATCHes a single key, and retire/restore. `TemplatesPage` renders each template as a document panel: plan badge, interval, validity, line count, template value, an itemised table of product / variant / quantity / unit price / line total, and its notes.

**Why this design.** The three screens are deliberately different shapes — a ledger, cards, and documents — because the three things are different: products are a list to search, plans are offers to compare, templates are paperwork to read. Colour encodes the billing interval rather than decorating, so a glance tells you what kind of plan you are looking at. Retired items stay visible to Admin with a muted style, which is what makes "restore" discoverable.

**Q&A — How do these screens satisfy the "no static JSON" rule?**
Every value — prices, variant surcharges, flags, line totals — comes from the three API calls and ultimately from PostgreSQL. The only literals in the components are labels and layout.
**Q&A — Why does toggling a flag not reload the whole page?**
The PATCH returns the updated plan, which replaces that one card in local state. One request, no flicker, and the server remains the source of truth for what was stored.

---

## 14. Verification evidence — Milestone 2

Executed against a freshly created PostgreSQL 18 cluster on port 5433 with a throwaway `DATABASE_URL`, driving the compiled API with 61 assertions.

| Check | Result |
| :--- | :--- |
| `server npm run build` (`tsc`) | Exit 0 |
| `client npm run build` (`tsc` + `vite`) | Exit 0, JS bundle 246.78 kB |
| Schema applied to a fresh database | 14 tables, 46 indexes |
| Schema + seed applied a second time | Identical row counts (3 users, 3 products, 2 variants, 4 plans, 3 templates, 6 lines) |
| Anonymous `GET /products` | 401 |
| Seeded prices | ERP 1200, add-on 150, support 300 |
| Odoo variant `priceExtra` / effective price | 560 / **1760** (AC2.1) |
| Empty body, bad type, negative price, empty PATCH | 400 each, with field messages |
| Duplicate product name in different case | 409 |
| Duplicate variant, different case | 409 |
| Negative `priceExtra` | 400 |
| Variant on a missing product | 404 |
| Retire product → customer list / admin list | Hidden / still visible; restore returns it |
| Seeded plans | 4; Annual Enterprise `autoClose = true`, daily trial `allowRenew = false` (AC2.2) |
| `availableFrom` serialised | `"2026-01-01"` — no timezone shift |
| Invalid interval / reversed window / `minQuantity` 0 | 400 each |
| New plan flags → PATCH one flag → re-read | Persisted across all three reads |
| Seeded "Enterprise Monthly Starter" | Brand: Odoo line at 1760, total 3970 |
| Template created without `unitPrice` | Server filled 1760 and 300, total 3820 (AC2.3) |
| Duplicate line / cross-product variant / unknown plan / no lines | 400 each |
| Staff reads templates / creates one | 200 / 403 |
| Staff creates product or plan, toggles a flag | 403 each |
| Customer creates product, reads templates | 403 / 403 |
| Three list calls (products, plans, templates) | 6 ms total |
| **Total** | **61 passed, 0 failed** |

The disposable cluster and the API process were stopped and the cluster directory deleted afterwards; the repository `.env` is unchanged.

---

## 15. Deliberate boundaries at the end of Milestone 2

- Subscription records, the state machine and the customer portal — Milestone 3.
- Tax rules in the billing engine, discount evaluation and the billing run — Milestone 4.
- Invoice actions (confirm, cancel, send, print) and payment recording — Milestone 5.
- Finance dashboard aggregates, filters and the thousand-subscription seed — Milestone 6.

No screen in this milestone displays a number that is not stored in PostgreSQL.

---

## Milestone 3 — Subscription Lifecycle & Customer Self-Service Portal

**Commit scope:** shared zod field builders, subscription validation, a subscription repository with row locking, the state-machine service, staff and portal route modules, a service-driven demo seed, the status stepper, the subscription board, the contract detail screen and the customer portal.
**Verified:** both workspaces compile (`tsc`), the client bundles (279 kB), the schema and seed apply twice in a row with identical row counts, and **62 of 62** live API assertions pass against a freshly created PostgreSQL 18 cluster — including AC3.1 (sequence numbering `SUB-2026-1001` → `1004`), AC3.2 (only legal transitions, `Paused` only when `allow_pause`), AC3.3 (a customer sees only their own contracts; another customer's id returns **404**) and AC3.4 (an add-on toggle rewrites the line and contract totals; pausing a plan with `allow_pause = FALSE` returns 400).

### Repository additions

```
server/src/utils/zod-fields.ts               shared field builders (money, text, date, id, quantity, boolean)
server/src/utils/subscription.validators.ts  status enum, payment terms, create/status/add-on/renew schemas
server/src/repositories/subscription.repository.ts
server/src/services/subscription.service.ts
server/src/routes/subscription.routes.ts     /subscriptions (Admin, Staff)
server/src/routes/portal.routes.ts           /portal/subscriptions (Customer)
client/src/lib/subscription-status.ts        tones, flow order, transition verbs, payment terms
client/src/components/subscriptions/StatusStepper.tsx
client/src/components/subscriptions/NewSubscriptionModal.tsx
client/src/pages/SubscriptionsPage.tsx
client/src/pages/SubscriptionDetailPage.tsx
client/src/pages/PortalPage.tsx
```

---

## 16. Shared validation — `zod-fields.ts` and `subscription.validators.ts`

**How it works.** `zod-fields.ts` holds the primitives every schema needs: `moneyField` (finite, 0–9,999,999,999.99, at most two decimals), `textField` (trimmed, length-bounded, field-named messages), `dateField` (`YYYY-MM-DD` plus a real-calendar check), `idField`, `quantityField` (whole number 1–10,000), `booleanField` and `optionalNotes`. `catalog.validators.ts` now imports them instead of defining its own copies. `subscription.validators.ts` declares `SUBSCRIPTION_STATUSES`, `PAYMENT_TERMS`, and the four request shapes: create (with an XOR refine between `templateId` and `planId` + `lines`, and an expiry ≥ start check), status change, lifecycle reason, add-on toggle, and renewal (with its own date check).

**Why this design.** Milestone 2 had the money and date rules written inside the catalog validators. A subscription line needs exactly the same money rule, and a second copy would drift the day one of them changed — so the rule moved to one module and both domains consume it. The XOR refine is validation, not business logic: "both modes at once" is a malformed request, and refusing it in the schema means the service never has to guess which mode was meant.

**Q&A — Why does `.strict()` matter on every schema?**
It turns an unexpected key into a named 400 instead of silently dropping it. A client that tries to set `status` on create is told it cannot, rather than receiving a draft it thought was active.
**Q&A — Why is the state machine not encoded in zod?**
The schema only knows that a status is one of six valid strings. Which of the six may follow which depends on the stored row and the plan flags, so that decision belongs in the service where the row is loaded.

---

## 17. Subscription repository — `subscription.repository.ts`

**How it works.** `SUBSCRIPTION_COLUMNS` / `SUBSCRIPTION_FROM` join `users` (customer), `subscription_plans` (price, interval and the four flags) and, optionally, `quotation_templates`. `listSubscriptions` builds its WHERE clause from an optional `customerId` and `status`; `findSubscriptionById` reads one contract. `listLinesForSubscriptions` fetches the lines for a whole page of contracts in **one** query with `= ANY($1::int[])`, ordered so add-ons and core lines stay grouped. `lockSubscription` runs `SELECT id, status … FOR UPDATE` for transitions. `insertSubscription` builds the number in SQL — `'SUB-' || to_char(CURRENT_DATE,'YYYY') || '-' || lpad(nextval('seq_subscription_number')::text, 4, '0')` — and `insertSubscriptionLines` writes the whole contract in one multi-row INSERT, deriving `is_addon` from the product type. `updateSubscription` maps a camelCase patch through `buildUpdateSet`. `updateAddonLine` sets `is_addon_active` and rewrites `subtotal` / `total_amount` (inactive = 0). `renewSubscription` reopens a contract with `COALESCE($2::date, CURRENT_DATE)` and derives `expiry_date` from the plan interval in SQL.

**Why this design.** Generating the number inside the INSERT removes any window where the sequence and the string disagree, and the sequence guarantees two concurrent creates cannot pick the same value. `FOR UPDATE` closes the other race: two pause requests both reading `Active` and both succeeding. Rewriting the add-on's stored subtotal means every later reader — board, portal, and the Milestone 4 billing run — agrees without re-deriving the amount. The batch line query exists because the board shows many contracts at once; an N+1 query per row would break the two-second rule.

**Q&A — Why `FOR UPDATE` rather than a version column?**
A version column would need a retry loop in every caller and an extra column on the table. These operations are short and single-row, so taking the row lock for the duration of the transaction is simpler and gives the same guarantee.
**Q&A — Why is the subscription number not generated in Node?**
Because `nextval` is atomic and shared. Formatting happens in the same statement as the insert, so the number can never be duplicated or skipped between a read and a write.

---

## 18. Subscription service — the state machine

**How it works.** `toSubscriptionDto` converts NUMERIC text with `toAmount`, exposes the plan flags under `flags`, computes `subtotal` / `addonTotal` / `total` from the billed lines, and publishes `allowedTransitions` — the legal next states already filtered by plan flags. The transition table is `Draft → Quotation | Closed`, `Quotation → Confirmed | Closed`, `Confirmed → Active | Closed`, `Active → Paused | Closed`, `Paused → Active | Closed`, `Closed → Active`. `transitionStatus` takes the row lock, reloads the contract, then `applyTransition` checks the table, checks the flag that move needs (`allow_pause`, `allow_early_close`, `allow_renew`), writes the new state with `paused_at` / `closed_at`, sets `next_billing_date` to the later of the stored date and today on resume, and records an audit event (`SUBSCRIPTION_STATUS_PAUSED`, `SUBSCRIPTION_RENEWED`, …). `listSubscriptions` forces the tenant filter to the requester's own id for a customer; `getSubscription` and every portal action return **404** for another customer's contract.

**Why this design.** A single table plus a single `applyTransition` means the staff board and the customer portal cannot disagree about what is legal, and the UI never has to re-implement a plan rule — it renders the server's `allowedTransitions`. Choosing 404 over 403 for a foreign id avoids confirming that a contract exists at all. Resuming with `max(stored, today)` prevents a contract paused for two months from waking up with a billing date in the past and billing several cycles at once.

**Q&A — Why is `allowedTransitions` computed on the server instead of in React?**
Because the flags live on the plan row in PostgreSQL. If React computed the buttons, a stale client could offer "Pause" on a plan that forbids it; the server would refuse, but only after a confusing round trip. One computed list keeps the UI honest.
**Q&A — What stops two simultaneous transitions from both succeeding?**
The transaction takes `SELECT … FOR UPDATE` on the subscription row first. The second request waits, then reloads a contract whose status has already changed, and its transition is rejected as illegal from the new state.

---

## 19. Creation — from a template, or built by hand

**How it works.** `createSubscription` requires Admin or Staff, verifies the target account is an active `CUSTOMER`, then chooses one of two builders. `buildFromTemplate` loads the template and its plan, refuses an inactive or out-of-window plan, copies every template line with the product type deciding `is_addon`, and checks the plan's `min_quantity` against the **base** lines. `buildManual` loads the plan, then for each input line calls `resolvePricedLine` — which rejects an inactive product or a variant from another product — uses the supplied `unitPrice` when given and the catalogue price otherwise, rejects duplicate product+variant pairs, and applies the same minimum-quantity floor. Both paths insert the contract and all lines inside one transaction, together with a `SUBSCRIPTION_CREATED` audit row, then return the reloaded DTO.

**Why this design.** The template path copies prices rather than re-pricing, because a template is a priced offer and re-pricing would silently change what the customer was quoted. The manual path deliberately leaves `unitPrice` optional so the catalogue rule (`salesPrice + priceExtra`) has one owner — the server — and a hand-built line can still carry a negotiated price. Counting only base lines towards `min_quantity` stops an add-on from satisfying a seat minimum.

**Q&A — Why refuse a template whose plan is out of its availability window?**
The window is the Admin's statement of when the offer may be sold. Copying a retired or not-yet-open plan would create a contract the company never intended to sell, so the API refuses rather than trusting the client to have filtered the list.
**Q&A — Why are duplicate product+variant lines an error rather than merged silently?**
Merging would change a negotiated line price without telling anyone. Refusing and asking for one combined line keeps the contract an exact record of what was agreed.

---

## 20. Routes — the staff board and the customer portal

**How it works.** `subscription.routes.ts` mounts `/subscriptions` behind `authenticate` + `requireRole('ADMIN','STAFF')`, and exposes `GET /` (optional `status` and `customerId` filters), `GET /:id`, `POST /` and `PUT /:id/status`. `portal.routes.ts` mounts `/portal` behind `authenticate` + `requireRole('CUSTOMER')` and exposes `GET /subscriptions`, `GET /subscriptions/:id`, `PATCH /subscriptions/:id/addons`, and `POST /subscriptions/:id/pause|resume|early-close|renew`. Both are registered in `routes/index.ts`; every body passes through `validateBody`, and `parsePositiveIntParam` rejects a malformed id before a query runs.

**Why this design.** Two routers, not one with conditional branches, make the role boundary visible in the file tree and in the README. The portal never accepts a customer id from the client — it passes `req.user` and the service supplies the filter — so there is no parameter an attacker can tamper with. The early-close and pause endpoints exist beside `/status` because the customer's wording is a business action ("pause my plan"), while the staff board speaks in states.

**Q&A — Why keep both `/status` and the named lifecycle endpoints?**
They share one implementation. The named endpoints give the portal a self-explanatory verb and a separate audit action, while `/status` gives the staff board one uniform control. Neither can bypass `applyTransition`.
**Q&A — Is `requireRole('CUSTOMER')` on the portal enough to isolate tenants?**
No, and it is not relied on alone. The role stops staff from entering the portal; the service then filters by the requester's id and returns 404 for a foreign contract, so authorisation is enforced twice.

---

## 21. Frontend — stepper, board, detail and portal

**How it works.** `lib/subscription-status.ts` maps each status to a badge tone, defines the five-step `MAIN_FLOW` (Paused sits on the Active step), and turns a transition into a verb (`Send quotation`, `Confirm quotation`, `Activate`, `Pause`, `Resume`, `Renew`, `Close early`). `StatusStepper` renders the flow with completed, current and upcoming styles and marks a paused contract on the Active step. `SubscriptionsPage` loads `/subscriptions`, derives its Active / Pipeline / Paused / Closed counters from the same rows it tabulates, filters by status and by a free-text search, and links each row to the detail screen. `SubscriptionDetailPage` renders the stepper, one button per server-provided `allowedTransitions`, the contract fields, the four plan rules and the priced lines. `PortalPage` renders each contract as a card: stepper, lines with an accessible `Switch` on add-on lines (enabled only while Active), totals, and the self-service buttons mapped to the portal endpoints. `NewSubscriptionModal` offers the two creation modes as a real choice, prefills line prices from the catalogue, and posts exactly one mode.

**Why this design.** The stepper is the acceptance criterion made visible — an evaluator can watch a contract advance and see the bar move. Building the action buttons from `allowedTransitions` rather than from a local copy of the rules means the UI cannot offer an action the server will refuse. The three screens are shaped by who uses them: staff get a sortable board and a contract dossier; customers get a card per contract with the switches and verbs their plan permits, in the second person.

**Q&A — Why does the stepper show Paused in place of Active?**
Because pause is a temporary condition of an active contract, not a sixth milestone. Showing it on the Active step tells the reader both that the contract is past confirmation and that it is not currently billing.
**Q&A — What does the portal do if a plan forbids pausing?**
Nothing is rendered to offer it. The server's `allowedTransitions` already omits `Paused`, so the customer sees no pause button, and a hand-crafted request would still receive the plan-flag 400.

---

## 22. Seed — demo contracts created through the service

**How it works.** After accounts, products, plans and templates are seeded, `seedSubscriptions` returns immediately if `subscriptions` already has rows. Otherwise it loads the Admin and the demo customer, creates an "Enterprise Monthly Starter" contract through `subscriptionService.createSubscription`, walks it `Quotation → Confirmed → Active` through `transitionStatus`, and creates a second contract from the Annual template that it leaves in `Draft`. The final report prints contract and line counts.

**Why this design.** Raw INSERTs in a seed script drift from the rules the API enforces — a hand-written row can carry an `is_addon` the product type contradicts. Reusing the service means the demo data is produced by exactly the code path an evaluator will exercise, including the sequence-generated number and the audit rows. The `COUNT(*) = 0` guard makes re-running the seed a no-op instead of duplicating demo contracts next to real ones.

**Q&A — Why not just insert two subscriptions with SQL?**
Because a SQL insert would bypass numbering, plan-availability checks and line pricing, and the demo data could quietly disagree with what the API produces. Going through the service makes the seed itself a smoke test.
**Q&A — What happens if the seed runs on a database that already has contracts?**
It skips the demo set entirely. Demo data must never appear next to a customer's real contracts, and `db:seed` has to stay safe to re-run.

---

## 23. Verification evidence — Milestone 3

Executed against a freshly created PostgreSQL 18 cluster on port 5433 with a throwaway `DATABASE_URL`, driving the API with 62 assertions (plus two portal lifecycle calls afterwards).

| Check | Result |
| :--- | :--- |
| `server tsc --noEmit` | Exit 0 |
| `client npm run build` (`tsc` + `vite`) | Exit 0, JS bundle 279.23 kB |
| Schema applied to a fresh database | 14 tables, 46 indexes |
| Seed applied twice | Identical counts; second run inserts no contracts |
| Seeded contracts | `SUB-2026-1001` Active, `SUB-2026-1002` Draft |
| New contract from template | `SUB-2026-1003`, Draft, 3 lines, add-on flagged, Odoo line 1760 (AC3.1) |
| Manual contract | `SUB-2026-1004`, Draft, catalogue price filled (1200) |
| `Draft → Active` directly | 400 |
| `Draft → Quotation → Confirmed → Active` | 200 each; `next_billing_date` set |
| `Active → Paused → Active` | 200 each; `paused_at` set then cleared (AC3.2) |
| `Active → Closed → Active` | 200 each; `closed_at` cleared on renew |
| Annual plan (no pause, no early close) | `Paused` and `Closed` → 400 with plan-flag message |
| Second customer's portal | 200, empty list |
| Fetching another customer's contract | **404** (AC3.3) |
| Staff on `/portal/subscriptions` | 403 |
| Customer on `/subscriptions` (list or create) | 403 both |
| Add-on switched off | 200; line `subtotal` 0; contract total drops by exactly the line amount (AC3.4) |
| Add-on switched back on | 200; total restored |
| Toggling a core line | 400 |
| Toggling an add-on on a Draft contract | 400 |
| Customer pause / resume via portal | 200 / 200 |
| Another customer pausing that contract | 404 |
| Duplicate product lines / plan minimum / both modes / neither mode | 400 each |
| Malformed date / expiry before start / staff as customer | 400 each |
| Unknown status / missing contract | 400 / 404 |
| Portal `early-close` then `renew` | `Closed` then `Active`, expiry derived +1 month |
| Audit rows | `SUBSCRIPTION_CREATED` ×4, status events per transition, `ADDON_ENABLED`/`ADDON_DISABLED` |
| Both list endpoints | Asserted under 2 seconds per call |
| **Total** | **62 passed, 0 failed** |

The disposable cluster and the API process were stopped, and the cluster directory and verification script deleted afterwards; the repository `.env` is unchanged.

---

## 24. Deliberate boundaries at the end of Milestone 3

- Invoice generation, tax rules, discount evaluation and the billing run — Milestone 4.
- Invoice actions (confirm, cancel, send, print) and payment recording — Milestone 5.
- Finance dashboard aggregates, filters and the thousand-subscription seed — Milestone 6.

A subscription's stored `subtotal`, `total_amount` and `is_addon_active` are the amounts the billing run will copy; no screen in this milestone displays a figure that is not stored in PostgreSQL.

---

# Milestone 4 — Automated Billing Day, Taxes, Discounts & Invoices

## 25. Schema — `tax_rules`, `discount_rules`, `invoices`, `invoice_lines`

**File & component.** `server/src/db/schema.sql` (sections 8, 9, 12, 13) plus two new columns on `subscriptions` (`discount_rule_id`, `tax_rule_id`).

**How it works.** `tax_rules` stores `name`, `rate NUMERIC(5,2) CHECK (rate BETWEEN 0 AND 100)`, `is_active` and `is_default`. A **partial unique index** — `CREATE UNIQUE INDEX uq_tax_rules_single_default ON tax_rules (is_default) WHERE is_default = TRUE` — makes "two defaults" a database-level impossibility. `discount_rules` carries `code UNIQUE`, `discount_type` (`percentage`/`fixed`), `discount_value`, `scope` (`whole_subscription`/`specific_product`), `target_product_id`, `min_purchase_amount`, `min_quantity`, `start_date`, `end_date`, `max_uses`, `current_uses` and four CHECK constraints: `chk_discount_dates`, `chk_discount_scope_target`, `chk_discount_usage` (`current_uses <= max_uses`) and `chk_percentage_cap`. `invoices` holds `invoice_number UNIQUE`, `billing_cycle_key UNIQUE`, `status CHECK IN ('Draft','Confirmed','Paid','Cancelled')`, the four money totals, `amount_paid`, `sent_at` and `cancelled_at`, with `chk_invoice_dates` and `chk_invoice_paid_within_total`. `invoice_lines` copies the price, the discount (`discount_amount`, `discount_code`, `discount_rule_id`) and the tax (`tax_rule_id`, `tax_name`, `tax_rate`, `tax_amount`) at issue time. Indexes: `idx_subs_active_billing (status, next_billing_date) WHERE status = 'Active'`, `idx_invoices_status_due (status, due_date)`, `idx_invoices_customer_status (customer_id, status, issue_date DESC)`, `idx_invoices_subscription`, `idx_sub_lines_subscription`.

**Why this design.** `uq_invoice_billing_cycle` is the idempotency guarantee, not a service-level `if`: even two processes on two machines cannot write the same cycle twice. The partial unique index solves "one default" with an index instead of a boolean the service must keep consistent. `tax_rule_id` on `invoice_lines` is `ON DELETE RESTRICT` — a rate that has priced a real invoice may be retired but never deleted, because deleting it would leave an invoice claiming a tax that no longer exists in any table; `discount_rule_id` is `ON DELETE SET NULL` because the line already stores `discount_code` and `discount_amount`, so the code survives the rule. Snapshotting name and rate onto the line means editing a tax rule later never rewrites history — which is exactly what a finance team needs when a rate changes mid-year.

**Q&A — Why is `billing_cycle_key` a `UNIQUE` column instead of a composite key on `(subscription_id, billing_cycle_date)`?**
Both give the same guarantee, but a single column also carries the shape of the cycle, which makes the idempotency rule readable in the audit log and lets a future cycle type (proration, one-off) share the table without changing the primary key. It is still derived deterministically as `sub_{subscription_id}_{billing_cycle_date}`.
**Q&A — Why store `tax_name` and `tax_rate` on the line when the rule id is already there?**
Because a rule can be renamed or re-rated after the invoice is issued, and an invoice is a legal document that must keep the rate it was issued at. The id keeps the audit link, the copied values keep the document truthful.

---

## 26. Tax rules — repository, service, routes

**File & component.** `server/src/repositories/tax.repository.ts`, `server/src/services/tax.service.ts`, `server/src/routes/tax.routes.ts`.

**How it works.** `listTaxRules(includeInactive)` filters to active rules only for a customer and returns everything for staff. `createTaxRule` / `updateTaxRule` run inside `withTransaction`: when `isDefault` is set, every other row is set to `is_default = FALSE` **before** the new one is written, so the partial unique index is never momentarily violated. Update refuses to make an inactive rule the default (`willBeActive = input.isActive ?? existing.is_active`), refuses duplicate names with a 409, and deactivation clears the default flag. `resolveTaxRule(subscription, rules, client)` returns the contract's own `tax_rule_id` when it is still active, else the active default, else `null` (zero-rated). Routes: `GET /` for every authenticated role, `POST/PATCH/DELETE` behind `requireRole('ADMIN')`.

**Why this design.** Swapping the default inside one transaction is the only way to keep the single-default index happy under concurrency: a read-then-two-writes would leave two `TRUE` rows. Resolving the tax on the server, per billing transaction, means a rate change applies to every future invoice without touching the contracts — while issued invoices keep their snapshot. Deleting a rate is a soft retire (`is_active = FALSE`) rather than a `DELETE`, because `invoice_lines.tax_rule_id` is `ON DELETE RESTRICT` and history must stay readable.

**Q&A — Why can a customer read tax rules?**
So the portal can explain what it is being charged. The service narrows the list to active rules; authoring is still Admin-only, so reading a rate never implies the right to change it.
**Q&A — What happens if the default rate is retired while contracts are active?**
`resolveTaxRule` skips the inactive row and falls back to the next active default. If no default exists the invoice is raised zero-rated rather than failing the whole billing run — an unknown tax is better announced than silently guessed.

---

## 27. Discounts — evaluation, allocation, and the AC4.2 lifecycle

**File & component.** `server/src/repositories/discount.repository.ts`, `server/src/services/discount.service.ts`, `server/src/routes/discount.routes.ts`, `server/src/utils/billing.validators.ts`.

**How it works.** `listApplicableDiscountRules` returns rules that are `is_active`, inside `[start_date, end_date]` for `CURRENT_DATE` and under `max_uses`. `computeDiscountForRule` returns `null` when the rule's scope or thresholds do not match the invoice's lines (a `specific_product` rule needs a line for its target; `min_purchase_amount` and `min_quantity` are checked against the participants), otherwise it computes the percentage of the participating subtotal or the fixed amount, **capped at the line subtotal**, and spreads it across lines with largest-remainder allocation in integer cents. `rankApplicableDiscounts` sorts best-first. `claimDiscountUse` runs `UPDATE discount_rules SET current_uses = current_uses + 1 WHERE … current_uses < max_uses AND CURRENT_DATE BETWEEN start_date AND end_date RETURNING …`; a `null` result means another transaction took the last use and the engine moves on to the next-best rule. `canNeverApplyAgain` (inactive, past `end_date`, or `current_uses >= max_uses`) triggers `detachFromSubscriptions`, which sets `discount_rule_id = NULL` on every contract still pointing at the dead rule — on retire, on an edit that kills it, and in the billing engine right after the claim that exhausted it.

**Why this design.** The usage cap lives in the `UPDATE … WHERE` clause because a read-then-write would let two concurrent billing runs both pass the check and overshoot `max_uses`. Detaching eagerly (rather than waiting for each contract's next billing day) keeps the data honest: a retired or exhausted rule should not still be shown as attached to a contract. Issued invoices keep `discount_code` and `discount_amount`, so removing the pointer never erases what a customer was actually charged. Percentage and fixed discounts share one code path, so the cap, scope and threshold rules cannot drift between the two types.

**Q&A — AC4.2 says an expired discount must stop applying and be de-linked. Where is that enforced?**
Three times over: the SQL selection excludes past-`end_date` rules, the atomic claim repeats the window check, and `detachIfDead` clears the attachment from every subscription as soon as the rule can never apply again. A future invoice therefore cannot contain it, and the contract no longer advertises it.
**Q&A — Why keep `current_uses` on the rule instead of counting invoice lines every run?**
A counter updated inside the claim is O(1) and race-safe; counting lines each run would scan the whole invoice history and still race between two runs. Because the count only ever goes up through the atomic claim, it can never exceed `max_uses` — the CHECK constraint would reject it if it tried.

---

## 28. Invoices — repository, state machine, and tenant isolation

**File & component.** `server/src/repositories/invoice.repository.ts`, `server/src/services/invoice.service.ts`, `server/src/routes/invoice.routes.ts`, `client/src/lib/invoice-status.ts`.

**How it works.** `insertInvoice` generates the number in SQL — `'INV-' || to_char(CURRENT_DATE,'YYYY') || '-' || lpad(nextval('seq_invoice_number')::text, 4, '0')` — and `insertInvoiceLines` writes all lines in one multi-row insert. `listInvoices` filters by optional customer, status, `from`/`to` and `limit`, ordered by `issue_date DESC, id DESC`; overdue is computed in SQL (`CURRENT_DATE - due_date`) so no row is re-read in Node. `toInvoiceDto` exposes `isOverdue`, `daysOverdue` and `allowedActions`, computed by `allowedActionsFor(status)` from one table: `confirm: ['Draft']`, `send`/`cancel`: `['Draft','Confirmed']`, `print`: `['Draft','Confirmed','Paid','Cancelled']`. `performInvoiceAction` takes `lockInvoice` (`SELECT … FOR UPDATE`), re-reads the row, rejects an illegal transition with a specific message (`This invoice is already confirmed.`, `A cancelled invoice cannot be confirmed.`), applies the patch (`status`, `cancelledAt`, `sentAt`, appended note) and records `INVOICE_CONFIRMED` / `INVOICE_SENT` / `INVOICE_CANCELLED` / `INVOICE_PRINTED` in the same transaction. `assertVisible` returns **404** for another customer's invoice.

**Why this design.** The legality of an action belongs on the server because the status is a database fact; the client receives `allowedActions` and renders only those buttons, so the UI cannot offer an illegal move. One action table plus one implementation means Confirm, Send, Cancel and Print can never disagree about which states they accept. The list query deliberately does not join lines — a hundred-invoice ledger should not fan out into a thousand lines just to draw header figures. For a customer, the tenant filter comes from the token, never the query string, and a foreign id is a 404 so the API does not confirm that someone else's invoice exists.

**Q&A — Why is printing a `POST` rather than a plain `GET` of a printable page?**
Because printing is an audited team action: the `POST` records `INVOICE_PRINTED`. The page itself is a normal authenticated route (`/invoices/:id/print`), and the toolbar offers a "Print invoice" button that records the action and then opens the browser dialog.
**Q&A — Why is `Paid` unreachable in this milestone?**
Payments arrive in Milestone 5. The state table already lists `Paid` for print and for the future transition, so adding the payment flow will not require editing the UI's action logic.

---

## 29. The billing engine — preview, run, and zero double-billing

**File & component.** `server/src/services/billing.engine.ts` (`previewBillingDay`, `runBillingDay`, `billOne`, `evaluateInvoice`, `advanceBillingCycle` call site), `server/src/routes/billing.routes.ts`.

**How it works.** `previewBillingDay` runs four reads in parallel — due subscriptions, expired auto-close contracts, tax rules, applicable discounts — fetches every line of the due contracts in one query, and evaluates each contract with the same `evaluateInvoice` the run uses; the result carries `dueCount`, `dueTotal`, per-contract subtotal/discount/tax/total and the list of contracts that will be auto-closed. `runBillingDay` first closes contracts whose `auto_close` plan flag and `expiry_date` are in the past (`SUBSCRIPTION_AUTO_CLOSED` per row), then bills the remaining due list one contract per **own transaction**: lock the row `FOR UPDATE`, re-check it is still `Active` and still due, build `billing_cycle_key = sub_{id}_{next_billing_date}`, look up that key (already billed → skip), take the billable lines (`!is_addon || is_addon_active`), rank and claim a discount, resolve the tax rule, insert the invoice and its snapshot lines, advance `next_billing_date`, de-link an exhausted rule, auto-close if the next cycle would start after expiry, and write `INVOICE_GENERATED`. A `23505` unique violation on the cycle key becomes a **skip**; an `AppError` becomes a **failure** for that row only. The response reports `totalEvaluated / generatedCount / skippedCount / failedCount / closedCount` plus the invoice summaries, skipped reasons, failures and closed contracts.

**Why this design.** The `UNIQUE (billing_cycle_key)` constraint is the real guard; the pre-check inside the lock is there to avoid consuming a discount for an invoice that will not be written. Both exist because the lock protects against an in-process race and the constraint protects against everything else — a second process, a retry, a manual re-run. One transaction per contract means a single broken contract cannot roll back the 999 that were fine, and the customer still gets a precise reason in `failures`. `advanceBillingCycle` advances one interval, or jumps to `CURRENT_DATE + interval` when the stored date has fallen far behind, so a contract can never stay due after a run and cause a burst of catch-up invoices. Because preview and run share `evaluateInvoice`, the figures the operator approves are exactly the figures that get invoiced.

**Q&A — AC4.3: what happens if the evaluator runs Billing Day twice?**
The first run bills every due contract and advances each `next_billing_date`; the second finds nothing due, so `generatedCount` is 0 — and even if a contract were somehow still due, the unique cycle key would turn the insert into a skip rather than a duplicate. Verified: run 1 generated 1 invoice, run 2 generated 0.
**Q&A — Why close expired contracts before billing instead of during the loop?**
The closing pass decides what is billable. Closing first means an expired contract is reported once, as closed, and never appears in the invoice list — the ordering is what makes "closed, not invoiced" deterministic instead of dependent on which check ran first inside the row transaction.

---

## 30. Routes — `/tax-rules`, `/discount-rules`, `/invoices`, `/billing`

**File & component.** `server/src/routes/tax.routes.ts`, `discount.routes.ts`, `invoice.routes.ts`, `billing.routes.ts`, mounted in `routes/index.ts`.

**How it works.** Every router starts with `authenticate`. `tax-rules`: read for all roles, write for `ADMIN`. `discount-rules`: the router is `ADMIN`/`STAFF` so staff can see what is running, while `POST/PATCH/DELETE` add `requireRole('ADMIN')` — a staff request is refused with 403 **before** the body is parsed. `invoices`: `GET /` and `GET /:id` for all roles (the service narrows a customer), `POST /:id/{confirm,send,cancel,print}` looped from `INVOICE_ACTIONS`, each through `validateBody(invoiceActionSchema)`. `billing`: `ADMIN`/`STAFF` only, `GET /pending` and `POST /run-billing-day`. Local helpers `parseStatusFilter`, `parseOptionalId`, `parseDateFilter` (rejects anything but `YYYY-MM-DD`) and `parseLimit` (1–500) validate the query string before SQL sees it, and `parsePositiveIntParam` guards ids.

**Why this design.** The 403-before-parse ordering is what makes AC4.1 unambiguous: an unauthorised role cannot even learn the shape of a discount payload from validation errors. Parsing dates in the route keeps PostgreSQL's `22007 invalid datetime format` from surfacing as a 500; the user gets "From date must be a date in YYYY-MM-DD format." Billing day is staff-only because it writes invoices for every customer at once.

**Q&A — Why does a staff account get 403 and not 400 on discount creation?**
Because authorisation is checked before body validation, by design. A 400 would leak which fields exist and invite probing; the middleware rejects the request on role alone.
**Q&A — What stops a customer from filtering the invoice list by another customer id?**
The route accepts `customerId` only as a staff convenience, and the service overrides it with `requester.id` for a customer. Whatever the query string says, the SQL is filtered by the token's owner.

---

## 31. Frontend — Billing Day, Invoice Studio, printable sheet, discounts and taxes

**File & component.** `client/src/pages/BillingDayView.tsx`, `InvoicesPage.tsx`, `InvoiceDetailView.tsx`, `PrintInvoiceView.tsx`, `DiscountsPage.tsx`, `TaxRulesPage.tsx`, `components/billing/DiscountFormModal.tsx`, `components/billing/TaxRuleFormModal.tsx`, `lib/invoice-status.ts`, `lib/navigation.ts`, `App.tsx`, `index.css`.

**How it works.** `BillingDayView` loads `/billing/pending`, shows the due count, the expected total and any contracts that will auto-close, tabulates each due contract with its subtotal, discount code, tax name/rate and total, then runs the billing day behind a confirmation `Modal`; the result panel lists the invoices just raised with links, the skipped reasons, the failures and the auto-closed contracts. `InvoicesPage` shows Outstanding / Collected / Overdue tiles derived from the ledger, a status filter and a search, and a table with an "N days late" hint on overdue rows. `InvoiceDetailView` renders the header, the bill-to block, the contract link, the cycle key, a totals card whose tax rows are grouped by `name@rate` from the line snapshots, and the line table; its action bar is built from `invoice.allowedActions`, with Print as a link and Cancel behind a confirmation. `PrintInvoiceView` is a standalone document outside `AppShell`: a `.no-print` toolbar whose "Print invoice" button posts the print action and then opens the browser dialog, and a `.print-sheet` article with the company header, bill-to, contract block, line table, tax breakdown and footer. `index.css` adds an `@media print` block that sets A4 margins, removes the tinted background and hides `.no-print`. `DiscountsPage` gives Admins create/edit/retire/restore and Staff a read-only view of the same rules, with a usage bar and a standing badge (Active / Scheduled / Expired / Exhausted / Inactive). `TaxRulesPage` lists rates with their default and status, and retires rather than deletes. `navigation.ts` and `App.tsx` add `/billing`, `/invoices`, `/invoices/:id`, `/invoices/:id/print`, `/discounts` and `/tax-rules`, each behind the same role guard the sidebar advertises.

**Why this design.** The action bar is data-driven from `allowedActions`, so a cancelled invoice shows only Print and a draft shows Confirm/Send/Cancel/Print — the screen can never offer a move the API will reject. The Billing Day screen shows the preview before the button because a bulk write deserves an approval step, and showing the exact totals first means the operator is approving figures, not an abstract "run". The print view lives at its own route, outside the shell, so the browser prints one clean sheet with no sidebar or page background. Discount forms mirror the server's rules locally so the user sees the same message before the round trip, while the server remains the authority.

**Q&A — What does the Billing Day screen do if a contract fails mid-run?**
It lists it under failures with the server's message while the invoices that succeeded stay in the ledger — each contract is its own transaction, so one failure does not discard the run.
**Q&A — Why is the customer allowed to open `/invoices` at all?**
The rubric gives a customer a portal for their own invoices. The page is shared, but `GET /invoices` narrows the result to the requester's id, so a customer sees only their own rows, and opening another customer's id returns 404.

---

## 32. Seed — tax and discount fixtures

**File & component.** `server/src/db/seed.ts` (`SEED_TAX_RULES`, `SEED_DISCOUNT_RULES`, `ensureTaxRule`, `ensureDiscountRule`).

**How it works.** `ensureTaxRule` looks the rule up by name, clears any old default inside a transaction and inserts GST 18% (default), VAT 10% and Zero-rated / Exempt 0. `ensureDiscountRule` looks up by `code`, attributes the rule to the Admin account, resolves the target product for the product-scoped rule and inserts `WELCOME10` (10% whole-subscription, 2026, 100 uses) and `SUPPORT25` (fixed 25 on Priority Support 24/7, `min_purchase_amount` 300, 50 uses), with `ON CONFLICT (code) DO NOTHING`. The report adds "Billing setup: N tax rules, M discount rules."

**Why this design.** The seed must produce data the API would accept: a default rate, a live percentage discount, a capped one and a product-scoped one, so every branch of the engine has a fixture. Looking up before inserting keeps `db:seed` idempotent — re-running it does not duplicate rules or steal the default flag back from an Admin who changed it.

**Q&A — Why seed a discount that a later run will exhaust?**
It gives the demo real usage: the first invoice consumes WELCOME10 and the verification then retires it through the API, exactly as an Admin would stop a promo. That path is also what proves the de-link behaviour.
**Q&A — Why attribute discounts to the Admin account?**
Because `discount_rules.created_by` is `NOT NULL REFERENCES users(id)`, and the rubric says only an Admin may create a discount. Seeding them under the Admin keeps the demo consistent with that rule.

---

## 33. Verification evidence — Milestone 4

Executed against a freshly created PostgreSQL 18 cluster on port 5433 (throwaway `DATABASE_URL`), schema applied (14 tables, 47 indexes), seeded, and the API driven over HTTP by a script of **52 assertions**, followed by SQL invariant queries.

| Check | Result |
| :--- | :--- |
| `server tsc --noEmit` | Exit 0 |
| `client tsc --noEmit` + `vite build` | Exit 0, JS 336.51 kB |
| Schema on a fresh database | 14 tables, 47 indexes |
| Seed | 3 accounts, 3 templates, 3 tax rules, 2 discounts, 2 contracts |
| Staff `POST /discount-rules` | **403** — "requires the ADMIN role" (AC4.1) |
| Staff `GET /discount-rules` | 200 (read-only) |
| Customer discount list / create | 403 / 403 |
| Tax rate 150 / percentage 150 | 400 each, field-level `details` |
| Product-scoped discount without target | 400 — "Choose the product this discount applies to." |
| End date before start date | 400 |
| Duplicate tax rule name | 409 |
| `GET /invoices?from=31-10-2026` | 400 before SQL |
| New default tax rule | Old default cleared; exactly one default remains; restored to GST 18% |
| `GET /billing/pending` before run | `dueCount 1`, `dueTotal 4216.14` |
| Run #1 | 1 generated, 0 skipped, 0 failed |
| Run #2 (same day) | **0 generated** (AC4.3) |
| Preview after run | `dueCount 0` |
| Invoice maths | 3970.00 − 397.00 + 643.14 = **4216.14**; tax name/rate and discount code snapshotted |
| Invoice number | `INV-2026-1001` |
| Confirm → confirm again | 200 then 400 "already confirmed" |
| Send / Print | `sentAt` recorded / 200 |
| Customer confirm | 403 |
| Auto-close contract (expiry 2 days ago) | Closed by the run, **not invoiced** |
| WELCOME10 + SUPPORT25 retired | 200; 200 |
| Expired rule stored | standing `Expired` |
| Two new contracts, one single-use rule | 1 discounted (198.50), 1 undiscounted (0.00) (AC4.2) |
| Expired rule on any invoice | never applied |
| Undiscounted invoice maths | 3970.00 + 714.60 = 4684.60; discounted 3970.00 − 198.50 + 678.87 = 4450.37 |
| Single-use counter | `current_uses 1 / max_uses 1`, standing `Exhausted` |
| Cancel with note / confirm a cancelled invoice | 200 / 400 |
| Customer invoice list | Only their own rows |
| Another customer's invoice / billing day | **404** / 403 |
| SQL: duplicate `billing_cycle_key` | 0 |
| SQL: invoice total ≠ Σ line totals | 0 |
| SQL: double-billed subscription + cycle | 0 |
| SQL: subscription still pointing at a dead rule | 0 |
| SQL: lines whose rule was retired afterwards | 3 — expected; history keeps its snapshot |
| **Total** | **52 passed, 0 failed** |

The disposable cluster and the API process were stopped, and the cluster directory, logs and verification script deleted; the repository `.env` was never modified or printed.

---

## 34. Deliberate boundaries at the end of Milestone 4

- Payment recording, the `Paid` transition and the outstanding/overdue finance aggregates — Milestones 5 and 6.
- Bulk seed of thousands of subscriptions and the `< 2 s` dashboard benchmark — Milestone 6; the indexes that benchmark depends on (`idx_subs_active_billing`, `idx_invoices_status_due`, `idx_invoices_customer_status`) are already in place.
- No email is actually sent by `send`; the action records `sent_at` and the audit row, which is the state change the rubric asks for.
- `PortalPage` does not list invoices inline; customers reach their own invoices through `/invoices`, which the API already narrows to their records.

---

## 35. The `payments` table — the money ledger

**File & component:** `server/src/db/schema.sql`, section 14 (`payments`), indexes `idx_payments_date_amount`, `idx_payments_invoice_id`, `idx_payments_customer`.

**How it works:** One row per receipt. `payment_number` is unique and generated from `seq_payment_number` as `PAY-` + the current year + a zero-padded four-digit sequence value. `invoice_id` references `invoices`, and `customer_id` and `recorded_by` reference `users`, all with `ON DELETE RESTRICT`; the row also carries `amount NUMERIC(12,2) CHECK (amount > 0)`, a `payment_method` restricted to the four rails by a `CHECK`, `payment_date DATE`, `reference_note TEXT` and `created_at TIMESTAMPTZ`. `invoices.amount_paid` holds the running total; the payments table is the evidence behind that total.

**Why this design:** A ledger table plus a denormalised running total is the standard balance pattern: summing `payments` on every invoice read would grow with history, while trusting only `amount_paid` would leave no audit trail of individual receipts. `RESTRICT` on the foreign keys means a paid invoice can never be deleted out from under its payments, and `CHECK (amount > 0)` keeps refunds from being smuggled in as negative receipts.

**Q&A — Why not store the payment number as `SERIAL`?** Because the rubric wants a readable `PAY-2026-XXXX` reference on the receipt, and the year belongs in the number but not in a plain integer sequence. The sequence still guarantees uniqueness; `to_char` and `lpad` only format it.

**Q&A — Why is `amount_paid` allowed to disagree with the payments table?** It is not: every write goes through one transaction, and the verification pass asserts `amount_paid = SUM(payments.amount)` on every invoice. The column exists so list screens can read a balance without an aggregate over the whole ledger.

---

## 36. `server/src/utils/payment.validators.ts` — request contract

**File & component:** `recordPaymentSchema`, `PAYMENT_METHODS`, `PaymentMethod`.

**How it works:** A `.strict()` zod schema accepts exactly five fields: `invoiceId` (positive integer), `amount` (money field refined to be greater than zero), `method` (enum of the four rails), `date` (real calendar date in `YYYY-MM-DD`), and an optional `note`. Unknown keys are rejected, so a client cannot smuggle `customerId` or `status` into the body. The rules that need the invoice row — status, remaining balance, issue date — are deliberately left to the service.

**Why this design:** The request contract is the cheapest place to reject nonsense, and every message names the field the form highlights. Splitting "shape" rules here from "state" rules in the service keeps the schema reusable and prevents the API from answering with a PostgreSQL `23514` naming a constraint instead of a sentence a clerk can act on.

**Q&A — Why is `amount` limited to two decimals?** Because the column is `NUMERIC(12,2)`; rounding in the API would silently change what the clerk typed. A third decimal is a typo, so it is answered with "Use at most two decimal places."

**Q&A — Why `.strict()` rather than stripping unknown fields?** Stripping hides client bugs and makes the API tolerant of attempts to set protected fields such as `customerId` or `recordedBy`. Rejecting the request means an integration failure shows up immediately instead of being silently ignored.

---

## 37. `server/src/repositories/payment.repository.ts` — SQL only

**File & component:** `listPayments`, `listPaymentsForInvoice`, `findPaymentById`, `insertPayment`.

**How it works:** Every select joins `payments` to `invoices`, `users` (the payer) and `users` (the staff member), so the API returns names rather than ids in one round trip. `listPayments` builds a parameterised `WHERE` for `invoice_id`, `customer_id`, `payment_date >= from` and `payment_date <= to`, orders by `payment_date DESC, id DESC`, and caps the result at 100 by default (500 maximum). `insertPayment` writes the formatted number inside the `INSERT` using `nextval('seq_payment_number')` and returns `id, payment_number` via `RETURNING`.

**Why this design:** The number is generated by the database, so two clerks pressing Save at the same moment cannot read the same "next" value — the failure mode of `SELECT max(...) + 1`. The repository contains no permission logic and no business rules; it only knows how to read and write rows, which is what lets the service own the reconciliation transaction.

**Q&A — Why join `users` twice?** Once for the customer who paid and once for the clerk who recorded it; they are different people. Two aliases in one query is cheaper than a second round trip and keeps the response shape flat.

**Q&A — Why cap the list at 100 rows?** The history screen never needs the entire ledger, and an unbounded scan is the first thing that breaks a two-second budget. The cap is a query parameter with a 500 ceiling, so a power user can still ask for more.

---

## 38. `server/src/services/payment.service.ts` — recording and reconciling

**File & component:** `recordPayment`, `listPayments`, `paymentsForInvoice`, `toPaymentDto`, `paymentMessage`.

**How it works:** `recordPayment` opens one transaction, locks the invoice row with `SELECT … FOR UPDATE`, re-reads it, and then refuses the request in this order: not a staff session (403), invoice missing (404), invoice `Draft` ("Confirm it before recording a payment"), `Cancelled`, `Paid`, a date in the future, a date before `issue_date`, or an amount above the outstanding balance. It then inserts the payment, applies it to the invoice, reloads the joined row, writes a `PAYMENT_RECORDED` audit event (plus `INVOICE_PAID` when the balance reaches zero) and returns `{ payment, reconciliation }` with `amountPaid`, `balanceDue` and the new status. The customer is copied from the invoice, never from the request.

**Why this design:** The lock makes the balance check race-free: a second payment for the same invoice waits, then sees the updated `amount_paid` instead of overpaying a stale figure. Every rejection names the field it concerns, so the modal can place the message under the offending input, and the audit row means the ledger answers "who took this money, when, and against which invoice".

**Q&A — Why return a reconciliation summary instead of the whole invoice?** The screen refetches the invoice anyway, and a summary avoids a circular import between `payment.service` and `invoice.service`. The three numbers the caller needs — status, paid, balance — are exactly the ones the response carries.

**Q&A — What happens if two clerks pay the same invoice simultaneously?** The second transaction blocks on `FOR UPDATE`, then re-reads the invoice and either applies against the reduced balance or is rejected with the over-payment message. The `CHECK (amount_paid <= total_amount)` constraint is the final guard if application logic were ever bypassed.

---

## 39. `invoice.repository.ts` additions — `applyPayment` and `listOverdueInvoices`

**File & component:** `applyPayment(id, amount, client)`, `listOverdueInvoices(customerId?, limit)`.

**How it works:** `applyPayment` is a single `UPDATE` that adds the amount to `amount_paid`, sets `status = 'Paid'` when the new total reaches `total_amount`, leaves `Cancelled` untouched, refreshes `updated_at`, and returns the new values with `RETURNING`. `listOverdueInvoices` selects invoices with `status = 'Confirmed' AND due_date < CURRENT_DATE`, optionally scoped to one customer, ordered by `due_date ASC`, and reuses the shared `INVOICE_COLUMNS`, so `days_overdue` is computed by PostgreSQL and `balance_due` follows from `total_amount - amount_paid`.

**Why this design:** Because PostgreSQL evaluates every `SET` expression against the *old* row, `status = CASE WHEN amount_paid + $2 >= total_amount …` sees the pre-payment balance — one statement, no read-modify-write gap, and the status can never disagree with the total. Overdue is computed in SQL rather than in JavaScript so "today" is the database's `CURRENT_DATE`, and drafts are excluded because a customer cannot be in arrears on a document they have never been sent.

**Q&A — Why not update `status` in a second query?** A second statement is a second chance to fail halfway, leaving an invoice paid but still `Confirmed`. One `UPDATE` makes the ledger and the state change atomic by construction.

**Q&A — Why is `days_overdue` computed per query instead of stored?** A stored value would be wrong the moment the clock passes midnight. `CURRENT_DATE - due_date` is exact at read time and costs nothing on an indexed date column.

---

## 40. `invoice.service.ts` additions — payments on the invoice, cancel guard, overdue list

**File & component:** `InvoiceDto.payments`, `toInvoiceDto(row, lines, payments)`, `getInvoice`, `reload`, `listOverdueInvoices`, `performInvoiceAction` cancel guard.

**How it works:** The invoice detail DTO now embeds its payment history, oldest first, so the screen renders totals and receipts from one response. `getInvoice` and `reload` load lines and payments inside the same client/transaction as the invoice row. `listOverdueInvoices` applies the tenant rule — a customer session is forced onto its own id — and returns the same DTO shape as the invoice list. `performInvoiceAction` refuses `cancel` on any invoice with `amount_paid > 0`, naming the amount already banked.

**Why this design:** Embedding payments keeps the detail page to one request, which is the performance rule applied at the document level. The cancel guard closes a gap the invoice state machine cannot see: `Confirmed` allows cancellation, but a part-paid `Confirmed` invoice would leave real money attached to a document nobody may act on again.

**Q&A — Why does a customer see the payment history at all?** A customer is entitled to their own receipts, and the invoice read is already tenant-scoped with a 404 for another customer's id. The same DTO simply carries fewer rows for them.

**Q&A — Why block cancellation rather than refund automatically?** Automatic refunds imply a payment gateway this system deliberately does not use. Requiring finance to reconcile the ledger first keeps every state change explicit and auditable.

---

## 41. HTTP surface — `/payments`, `/invoices/overdue`, shared query parsing

**File & component:** `routes/payment.routes.ts` (`GET /`, `POST /`), `routes/invoice.routes.ts` (`GET /overdue`), `utils/query-params.ts`, `routes/index.ts` mount.

**How it works:** `POST /api/v1/payments` validates the body, calls `recordPayment(req.user!.id, role, body)` via the service, and answers `201` with `{ payment, reconciliation }` and a message naming the `PAY-…` reference. `GET /api/v1/payments` accepts `invoiceId`, `customerId`, `from`, `to` and `limit`. `GET /api/v1/invoices/overdue` is registered **before** `/:id`, returns the late invoices with `daysOverdue` and `balanceDue`, and accepts `customerId` and `limit`. The query parsers moved into `utils/query-params.ts` so both routers reject `?from=31/10/2026` or `?limit=9999` with a named field instead of PostgreSQL's `22007`.

**Why this design:** Route order is a correctness issue, not a style one: with `/:id` first, Express would treat `overdue` as an id and answer 400. Mounting payments as its own resource keeps the invoice router about invoices, and centralising the parsers means the two ledgers cannot drift into different date formats.

**Q&A — Why is `/payments` a separate resource instead of `POST /invoices/:id/payments`?** The ledger is queried across invoices by date and customer for the finance view, which a nested path cannot express without duplication. The invoice id travels in the body, and the invoice read it triggers is the same tenant-checked one.

**Q&A — Why can a customer read payments but not create them?** Recording a receipt is a day-to-day staff duty per the brief, and letting a customer assert "I paid" would corrupt the ledger. Reading is scoped to their own rows by the service, not by the query string.

---

## 42. Frontend — Record Payment modal, receipt history and ledger filters

**File & component:** `client/src/lib/types.ts` (`Payment`, `PaymentReconciliation`, `RecordPaymentResult`, `Invoice.payments`), `client/src/lib/payment-method.ts`, `client/src/components/billing/PaymentFormModal.tsx`, `client/src/pages/InvoiceDetailView.tsx`, `client/src/pages/InvoicesPage.tsx`, `client/src/pages/PrintInvoiceView.tsx`.

**How it works:** On a `Confirmed` invoice with a balance, Detail shows a teal **Record payment** button that opens a modal prefilled with the full outstanding amount and today's date. The modal validates amount (numeric, greater than zero, two decimals, not above the balance), date (not future, not before the issue date) and note length before sending `POST /payments`; server field errors are mapped back onto the inputs with `ApiError.fieldErrors()`. A successful save closes the modal, shows the returned message and refetches the invoice, which updates the status badge, the balance, the action bar and the receipt table in one pass. The receipt table lists `PAY-…` reference, date, method badge (`Bank Transfer` plum, `Credit Card` teal, `UPI` emerald, `Cash` amber), note and amount. The invoice list gained All / Outstanding / Overdue pills with live counts, and the printed invoice carries a **Payments received** block when receipts exist.

**Why this design:** Prefilling the balance makes the common case one click while still allowing a partial amount, and mirroring the server rules in the form means the user sees the problem under the field instead of a banner after a round trip. Refetching rather than patching state locally keeps `allowedActions` authoritative — the moment an invoice is settled, Confirm/Send/Cancel disappear because the server says so, not because the client guessed.

**Q&A — Why does the page refetch instead of using the POST response?** The response is a reconciliation summary; the page also needs the recalculated `allowedActions`, the receipt list and the updated totals. One refetch returns all of them from the database, which is the rule the rubric grades.

**Q&A — Why show Outstanding and Overdue as filters rather than separate pages?** They are views of the same ledger, so a filter keeps the row, column and drill-down behaviour identical. The counts on the pills come from the same rows already on screen, so a filter never shows a number that disagrees with the table.

---

## 43. Verification evidence — Milestone 5

Executed against a freshly created PostgreSQL 18 cluster on port 5433 (throwaway `DATABASE_URL`), schema applied (14 tables, 47 indexes), seeded, API on port 5055, **77 live assertions** plus 8 SQL invariant queries.

| Check | Result |
| :--- | :--- |
| `server tsc --noEmit` | Exit 0 |
| `client tsc --noEmit` + `vite build` | Exit 0, JS 345.12 kB |
| Billing run | 1 invoice generated, `INV-2026-1001` |
| Payment on a Draft invoice | **400**, field `status`, "Confirm it before recording a payment." |
| AC5.2 partial payment | 201, `PAY-2026-1001`, status **Confirmed**, `amount_paid` 40% of total, balance the remainder |
| Invoice detail after partial | `payments` array carries the receipt; `balanceDue` matches |
| Over-payment / zero / negative / 3 decimals | 400 each, field `amount` |
| Unknown method / future date / pre-issue date / 2026-02-30 | 400 each, field `method` or `date` |
| Non-numeric or missing `invoiceId`, unknown key | 400, field `invoiceId` (or none for the extra key) |
| Unknown invoice | **404** |
| Customer `POST /payments` | **403** "Only internal staff can record payments." |
| AC5.1 final payment | 201, status **Paid**, `amount_paid` = total, balance 0, number `PAY-2026-1002` |
| Paid invoice actions | `["print"]` only |
| Payment on a Paid invoice | 400, "already fully paid" |
| Ledger filters | by invoice, by date range; a future range returns nothing |
| `?from=31/10/2026` | 400 named field, before SQL |
| Customer ledger | own 2 payments; a second customer sees **0**; `?invoiceId=` cannot widen it |
| Another customer's invoice | **404** |
| Cancel an invoice with payments | **400**, stays `Confirmed` |
| Cancelled invoice payment | 400, field `status`, "was cancelled" |
| AC5.3 `GET /invoices/overdue` | Late invoice present, `daysOverdue 5`, `balanceDue` = total − paid; the `Paid` invoice absent |
| Overdue tenant scope | Customer sees own; second customer sees 0 |
| SQL: `amount_paid = SUM(payments)` | 0 mismatches |
| SQL: `amount_paid > total_amount` | 0 |
| SQL: `Paid` but not settled | 0 |
| SQL: payment on another customer's invoice | 0 |
| SQL: duplicate / malformed payment numbers | 0 / 0 |
| SQL: payments recorded by a non-staff user | 0 |
| SQL: every payment has a `PAYMENT_RECORDED` audit row | 0 difference |
| SQL: total payments = total `amount_paid` | equal |
| **Total** | **77 passed, 0 failed** |

The disposable cluster and API process were stopped and the cluster directory, log and verification script deleted; the repository `.env` was never modified or printed.

---

## 44. Deliberate boundaries at the end of Milestone 5

- No refund or payment-reversal endpoint: a mistake is corrected by finance outside the ledger, and cancellation is blocked while payments exist. The state machine therefore never has to model negative receipts.
- No payment gateway integration, by design — the brief forbids third-party billing dependencies, and the rubric rewards building the ledger from scratch.
- Receipt numbers are sequential per installation, not per customer; the ledger is single-tenant per Brightloop instance.
- Bulk performance seeding (thousands of contracts, invoices and receipts) and the sub-two-second Finance Lead dashboard belong to Milestone 6; the indexes they depend on (`idx_payments_date_amount`, `idx_payments_invoice_id`, `idx_payments_customer`, `idx_invoices_status_due`) are already in place.


## 45. `server/src/repositories/finance.repository.ts` — aggregation SQL only

**File & component:** `server/src/repositories/finance.repository.ts` — `billableCte`, `subscriptionTotals`, `mrrByInterval`, `revenueTotals`, `invoiceTotals`, `overdueInvoices`, `planOptions`, `customerOptions`, `planExists`, `customerExists`.

**How it works:** Each exported function is one SQL statement. The recurring-revenue pair shares a CTE named `billable` that keeps one row per `Active` subscription holding `SUM(l.subtotal)` over its billable lines — `is_addon = FALSE OR is_addon_active = TRUE` — grouped by subscription id and the plan's `billing_interval`. `subscriptionTotals` then folds that CTE with `ROUND(SUM(CASE billing_interval WHEN 'daily' THEN period_amount * 30 WHEN 'weekly' THEN period_amount * 4.3333 WHEN 'monthly' THEN period_amount WHEN 'yearly' THEN period_amount / 12 END), 2)` for MRR and the matching 365 / 52 / 12 / 1 factors for ARR. `mrrByInterval` folds the same CTE a second time with `GROUP BY billing_interval`. `revenueTotals` sums `payments.amount` joined to its invoice and subscription so the plan filter can reach the contract, with the window applied to `payment_date`. `invoiceTotals` uses PostgreSQL `FILTER` clauses to produce four numbers in one row: outstanding balance (`status = 'Confirmed' AND total_amount > amount_paid`), open-invoice count, the overdue subset (`due_date < CURRENT_DATE`) and its count. `overdueInvoices` selects the chase list, ordered `due_date ASC, id ASC`, capped by a bound `LIMIT` parameter, and computes `days_overdue` and `balance_due` in SQL. Filter ids are always pushed as `$n` placeholders; nothing is string-concatenated.

**Why this design:** The rubric's performance requirement is a database requirement, so the dashboard hands PostgreSQL the aggregation instead of streaming rows to Node. `FILTER` turns four conditional passes over `invoices` into one, and because every status/date predicate matches an existing index, the planner never needs a table rewrite. `idx_subs_active_billing (status, next_billing_date) WHERE status = 'Active'` serves the contract scan, `idx_invoices_status_due (status, due_date)` serves the overdue split, and `idx_payments_date_amount (payment_date, amount)` served the date-window scan in `EXPLAIN ANALYZE` (`Bitmap Index Scan on idx_payments_date_amount`). No new index was added: at 2,700 invoices and 1,847 payments the plans already execute in under 1.1 ms, so an extra composite index would only add write cost — the database-designer rule is to index queries that actually need it, not every column a filter mentions.

**Q&A defence:**
1. *Why calculate MRR in SQL rather than summing the returned subscriptions in JavaScript?* Because the figures must stay correct when the book of business grows past what a single response should carry; `SUM` over an indexed scan costs one round trip regardless of row count, and it reuses the same normalised `subtotal` the billing engine stores. It also keeps the dashboard's two views of the same number — total MRR and the per-interval mix — computed from one definition, so they cannot drift.
2. *Why `FILTER (WHERE …)` instead of four separate queries or `CASE WHEN` sums?* `FILTER` is the standard PostgreSQL aggregate predicate: the engine scans `invoices` once and keeps four accumulators, and the SQL reads as four clearly-labelled business rules rather than a wall of `SUM(CASE WHEN … THEN … ELSE 0 END)`. Four separate queries would multiply round trips and could observe different snapshots if a payment landed between them.

---

## 46. `server/src/services/finance.service.ts` — dashboard rules and filter validation

**File & component:** `server/src/services/finance.service.ts` — `getDashboard`, `getFilterOptions`, `assertInternal`, `assertDateOrder`, `assertFilterTargets`, DTO mappers.

**How it works:** `getDashboard` first refuses a non-internal requester, then rejects a reversed date range with `field: 'endDate'`, then asks the repository whether a supplied `planId`/`customerId` exists so a stale URL is named rather than silently returning zeros. It then runs five repository calls concurrently with `Promise.all`, measures the wall-clock duration of that group with `performance.now()`, and converts every NUMERIC string to a JSON number with `toAmount` (which rounds to two decimals). The DTO carries the applied filters back verbatim, the four KPI figures, the interval mix, the chase list, `queryTimeMs` and `generatedAt`. `getFilterOptions` returns only plans and customers that own at least one contract, so the toolbar never offers a slice that is guaranteed empty.

**Why this design:** Filters are validated in the service, not the route, because "which id may narrow a report" is a business rule — the same reason permissions live here rather than only in middleware. Running the aggregates concurrently matters because each is independent and the endpoint's budget is two seconds for the whole page; sequential awaits would add four round-trip latencies for no benefit. Echoing `filters` in the response is a deliberate correctness device: the UI can prove which range produced the numbers on screen, so a stale request can never be mislabelled. `queryTimeMs` is measured server-side around the aggregate calls only, which is the honest way to evidence the `< 200 ms` database target without counting JSON serialisation or network time.

**Q&A defence:**
1. *Why does the date range narrow invoices and payments but not the MRR figure?* MRR is a snapshot of the contracts in force today, not a flow over a period; applying an invoice-date window to it would make "active subscriptions" disagree with the Subscriptions screen and would change meaning every time the range moved. The dashboard states that rule in the filter bar, and the amount filters that *are* period-based — collected, outstanding, overdue — all use their own event date: `payment_date` for cash, `issue_date` for invoices.
2. *What stops a customer account from reading company revenue?* Two independent gates: `requireRole('ADMIN', 'STAFF')` mounted on the finance router, and `assertInternal` at the top of both service functions. If a future route were mounted without the middleware the service would still throw `ForbiddenError`, and the verification run confirms `GET /finance/dashboard` returns **403** for a customer session and **401** without a token.

---

## 47. `server/src/routes/finance.routes.ts` and strict query parsing

**File & component:** `server/src/routes/finance.routes.ts`; `server/src/utils/query-params.ts` additions `parseIdFilter` and the optional `field` argument on `parseDateFilter`; `server/src/routes/index.ts` mount at `/finance`.

**How it works:** `GET /finance/dashboard` parses `startDate`, `endDate`, `planId`, `customerId` and `limit` before any service call. `parseDateFilter` refuses anything that is not `YYYY-MM-DD` and reports the camelCase field name the toolbar highlights; `parseIdFilter` refuses a non-integer or negative id instead of dropping it; `parseLimit` bounds the chase list to 1–500 (default 50). `GET /finance/filter-options` returns the plan and customer pickers. Both routes sit behind `authenticate` and the router-level `requireRole('ADMIN', 'STAFF')`.

**Why this design:** The invoice and payment ledgers use the lenient `parseOptionalId` because a malformed filter there is a convenience that can be ignored. The dashboard cannot afford that: silently dropping `planId=abc` would display company-wide revenue under a heading that claims it is filtered to one plan. Adding a strict sibling keeps both behaviours explicit at the call site rather than weakening the shared helper. The `field` argument on `parseDateFilter` was added with a default, so existing callers keep their behaviour while the dashboard reports `startDate`/`endDate` exactly as its inputs are named.

**Q&A defence:**
1. *Why have both `parseOptionalId` and `parseIdFilter`?* They encode different contracts: one treats the parameter as a best-effort convenience, the other treats it as a claim about what the user is looking at. Naming them separately makes the choice visible in each route instead of hiding a mode flag inside one helper.
2. *Why expose `/finance/filter-options` instead of letting the toolbar call `/plans` and `/admin/users`?* The dashboard needs the *reachable* slice — plans and customers that actually hold contracts — and it needs it in one request, without shipping the full staff directory to the browser. It is also one more place where the role gate is enforced consistently rather than relying on whichever endpoint happens to be staff-readable.

---

## 48. `server/src/db/seed_performance.ts` — thousand-row dataset and benchmarks

**File & component:** `server/src/db/seed_performance.ts`; npm script `db:seed:perf`.

**How it works:** The script checks for base fixtures (plans, products, a default tax rule, an internal user) and refuses with a clear message if `db:seed` has not run. A seeded `mulberry32` PRNG drives every random choice, so the dataset is reproducible. Inside one transaction it inserts 140 performance customers (email prefix `perf.customer…@brightloop.test`, shared bcrypt hash), 1,050 subscriptions across five lifecycle statuses and all four billing intervals, 2,095 subscription lines (base products plus active and paused add-ons), 2,700 invoices and 1,847 payments. Inserts are batched at 250 rows with `buildTuples` generating typed placeholders (`::date` for date columns) and ids are mapped back by `subscription_number` / `billing_cycle_key`. Payment amounts are derived from `amount_paid`, so every paid invoice reconciles exactly. After commit it advances `seq_subscription_number`, `seq_invoice_number` and `seq_payment_number` past the highest hand-written number, runs `ANALYZE`, then times the five real repository aggregates and prints three `EXPLAIN (ANALYZE, BUFFERS)` plans. `--reset` deletes only rows owned by the perf email domain, in foreign-key order.

**Why this design:** The performance claim has to be reproducible and must not touch the evaluator's demo data, hence the email-domain marker and the deterministic seed. Going through `subscriptionService`/`invoiceService` would be the wrong tool here: those paths exist to enforce one-contract-at-a-time business rules and each opens its own transaction, which would turn a 234 ms seed into minutes. Direct batched inserts still satisfy every constraint — foreign keys, checks, unique numbers and the billing-cycle key — because the constraints are in the schema, not in the services. Advancing the sequences is the subtle part: the generated documents deliberately live in the `…-9xxxxx` range, and without `setval` the next Billing Day run would collide with `uq_invoice_number`.

**Q&A defence:**
1. *Does seeding rows directly bypass your business logic and therefore prove nothing?* No — it proves the schema's own guarantees, which is what the rubric grades: every row passes the same foreign keys, CHECK constraints and unique indexes a service insert would, and the verification suite independently confirms payments reconcile to `amount_paid`. The services remain the only write path in the running application; this script is test-data tooling, clearly separated under `db/`.
2. *How do you know the dashboard queries remain fast at this volume rather than relying on a lucky cache?* The script runs `ANALYZE` after loading and prints the server's own plans: the contract aggregate executes in 1.074 ms, the invoice balance aggregate in 0.716 ms, and the payments window takes `Bitmap Index Scan on idx_payments_date_amount` in 0.497 ms. The endpoint additionally reports its own `queryTimeMs` (1.5 ms unfiltered), and the verification run re-checks the full HTTP response against the two-second budget.

---

## 49. `client/src/pages/FinanceDashboardView.tsx` — the finance lead screen

**File & component:** `client/src/pages/FinanceDashboardView.tsx` — `FinanceDashboardView`, `dashboardPath`, `apply`, `clearFilters`; supporting types in `client/src/lib/types.ts`.

**How it works:** The page keeps two filter sets: `draft` (what the inputs show) and `applied` (what the last successful request used). Selects apply immediately; date inputs apply only when the range is coherent, otherwise the hint explains that the dashboard is still showing the last valid range. `useApiResource` is called with a memoised `/finance/dashboard?…` path, so any change to `applied` triggers a refetch while the previous figures stay on screen under a loading state on the Refresh button. Four KPI cards show recurring revenue (MRR, ARR, active contracts, and the interval mix), cash collected with its receipt count, total outstanding with its open-invoice count, and total overdue with its late count. The chase table lists the oldest overdue invoices with customer, contract, due date, a days-late badge, the balance, and a "Record payment" link into the invoice screen where the payment modal already lives. A footnote reports `queryTimeMs` and the generation timestamp; the empty state explains what will appear once a due date passes.

**Why this design:** The rubric asks for interactive filters that recalculate metrics, so the screen never filters rows locally — every control changes the SQL the server runs, which is the only way the KPI totals and the chase list can agree. Keeping `draft` separate from `applied` is the difference between a recoverable mistake and a dashboard that blanks itself the moment someone clicks the wrong end of a calendar. The layout is deliberately uneven: recurring revenue is the largest card because it is the number a finance lead opens the page for, and the two debt cards sit below as a pair so outstanding and overdue read as one comparison. Colours follow the app's existing vocabulary — plum for revenue, emerald for cash, amber for owed, rose for late — and all amounts use tabular figures.

**Q&A defence:**
1. *How do the filters recalculate the metrics without a page reload?* Each control updates the applied filter state, which changes the memoised request path; `useApiResource` refetches and the server returns freshly aggregated figures, so the browser never adds anything up. Because the response echoes the filters it used, the screen can only ever label numbers with the range that produced them.
2. *What happens if someone selects an end date before the start date?* The input pair updates, the request is *not* sent, and a message under the toolbar says the end date must be on or after the start date while the dashboard continues to show the last valid range. If the same query is issued directly to the API, the service rejects it with **400** and `details[0].field = "endDate"`, which the verification suite asserts.

---

## 50. Navigation, routing and dashboard shortcuts

**File & component:** `client/src/lib/navigation.ts` (`NAV_ITEMS`, `PAGE_TITLES`), `client/src/App.tsx` (`/finance` route), `client/src/pages/DashboardPage.tsx` (finance shortcuts).

**How it works:** A `Finance` entry with a `LineChart` icon is added to `NAV_ITEMS` for `ADMIN` and `STAFF` only, and the same list drives the sidebar and the role guard. `App.tsx` wraps `FinanceDashboardView` in `ProtectedRoute` and `RoleRoute(['ADMIN', 'STAFF'])`. `PAGE_TITLES['/finance']` supplies the header title, and the landing dashboard gains three shortcut buttons — Finance dashboard, Billing day, Invoice ledger — for internal users.

**Why this design:** The navigation list is the single source of truth for both what is shown and what is protected, so a screen cannot appear without a guard. Adding the shortcuts on the landing page keeps the milestone discoverable without a dead link or an extra menu; a customer never sees the finance entry because the role filter removes it before render, and the API would refuse the call even if the URL were typed by hand.

**Q&A defence:**
1. *Is client-side role filtering enough to protect the finance screen?* No, and it is not relied upon: the route guard hides the sidebar entry for a customer, `RoleRoute` blocks the component, and the API independently returns **403** from `requireRole` plus the service guard. The verification suite exercises the last of those directly.
2. *Why link "Record payment" to the invoice instead of opening a modal on the dashboard?* The payment form needs the invoice's issue date, balance and allowed actions, which the invoice detail screen already loads and validates against; duplicating that state on the dashboard would create a second place where payment rules could drift. The link lands exactly where the existing, verified flow runs.

---

## 51. Verification evidence — Milestone 6

A disposable PostgreSQL 18 cluster was created on port 5433 (trust auth, separate temp directory), the schema applied, the base seed and `db:seed:perf` run, and the API started on port 5056 against it. `verify-m6.mjs` then ran 76 live HTTP and SQL assertions.

**Dataset**

| Measure | Value |
| :--- | :--- |
| Subscriptions | **1,052** (676 `Active`) |
| Subscription lines | 2,100 |
| Invoices | **2,700** (997 confirmed and overdue) |
| Payments | **1,847** |
| Perf customers | 140 |
| Seed duration | 234 ms |

**Dashboard figures vs independent SQL**

| Metric | API | Independent SQL |
| :--- | ---: | ---: |
| Active contracts | 676 | 676 |
| MRR | 5,425,014.05 | 5,425,014.05 (recomputed in JS from line subtotals) |
| ARR | 65,759,490.00 | matches the interval factors (ARR/MRR ≈ 12.12) |
| Collected | 3,305,045.23 | `SUM(payments.amount)` 3,305,045.23 |
| Payments | 1,847 | 1,847 |
| Outstanding | 2,128,146.77 | `SUM(total − paid) FILTER (Confirmed AND balance > 0)` |
| Open invoices | 1,041 | 1,041 |
| Overdue | 2,034,498.79 | overdue subset of the same predicate |
| Overdue invoices | 997 | 997 |
| `queryTimeMs` | 1.5 ms | — |
| HTTP response time | < 2 s (asserted) | — |

**What the 76 assertions cover**

- Metrics are identical to independently written SQL, including the MRR recomputation in JavaScript from the same billable rows.
- MRR slices sum to the total MRR; ARR is within the expected 12× band; overdue is a subset of outstanding by both amount and count.
- The chase list is capped at 50, ordered oldest-first, every row positive-balance, confirmed it is `Confirmed` and past due in SQL, and each `balanceDue = total − paid`.
- Filters narrow correctly: plan (MRR and contract count), customer (collected), 30-day window (collected, receipt count, overdue count), all four combined, and an empty historical window that returns zeros while still reporting live contracts.
- Validation: malformed date → 400 `startDate`; reversed range → 400 `endDate`; `planId=abc` → 400 `planId`; unknown plan → 400 naming the id; unknown customer → 400 `customerId`.
- RBAC: staff 200, customer 403 on both finance routes, anonymous 401.
- Timing: `/finance/dashboard`, `/finance/filter-options`, `/invoices?limit=100` and `/subscriptions` each under two seconds at this volume.
- SQL invariants: no invoice whose `amount_paid` disagrees with its receipts, no overpayment, document sequences ahead of every seeded number, and the dataset meets the 1,000 / 2,500 / 1,500 thresholds.

**`EXPLAIN ANALYZE` highlights**

| Query | Plan | Execution |
| :--- | :--- | ---: |
| Active contracts + billable lines | HashAggregate over `subscriptions` → `subscription_lines` | 1.074 ms |
| Confirmed invoice balances | Hash Join, single Aggregate with four `FILTER`s | 0.716 ms |
| Collected over 30 days | `Bitmap Index Scan on idx_payments_date_amount` | 0.497 ms |

`tsc --noEmit` is clean for the server and the client production build (`tsc --noEmit && vite build`) succeeds. The disposable cluster, API process and verification script were removed afterwards; `server/.env` was never modified or printed.

---

## 52. Deliberate boundaries at the end of Milestone 6

- No CORS-visible paging on the chase list beyond the bounded `limit`: the dashboard is a summary, and the invoice ledger is the place to work through the full list.
- No charting library: the interval mix is a compact list of real aggregates, which keeps the bundle small and avoids a dependency the brief does not ask for.
- No materialised views or caching layer: at the seeded volume every aggregate answers in ~1 ms, so caching would add staleness without buying anything the two-second budget needs.
- The profit/cost view (cost price against sales price) is not on the dashboard; the brief's finance-lead summary asks for revenue, outstanding and overdue, and margin reporting has no requirement attached to it.

---

## 53. Follow-up fix — document numbering past 9999, and cycle keys in the seed

**File & Component:** `server/src/repositories/document-number.ts` (new), consumed by `invoice.repository.ts`, `payment.repository.ts` and `subscription.repository.ts`; `server/src/db/seed_performance.ts`.

**How It Works:** Every document number used to be built as `'INV-' || to_char(CURRENT_DATE,'YYYY') || '-' || lpad(nextval('seq_invoice_number')::text, 4, '0')`. The performance seed pushed the sequences past 9,999, and the first payment recorded after that failed with `409 DUPLICATE_RECORD`: PostgreSQL's `lpad` *truncates* when the input is longer than the requested width, so `lpad('10001', 4, '0')` returns `'1000'` and the next document reissued a number already on file. `documentNumberExpression(prefix, sequence, width)` now emits one shared SQL fragment that calls `nextval` exactly once and pads to `GREATEST(4, length(value))`, so a number grows instead of being cut: `INV-2026-0007` early on, `PAY-2026-901848` at scale. The same change was applied to subscription numbers, which share the pattern. In the seed, each subscription's invoices now land on distinct `billing_cycle_date`s (a taken date steps back a day) and the stored `billing_cycle_key` is `sub_<subscription_id>_<date>` — the exact string the billing engine writes — so a later billing run recognises a seeded cycle by key instead of reaching the unique constraint.

**Why This Design:** The number belongs to the row being inserted, so it has to be generated in the same statement — a separate `SELECT nextval` would either race between concurrent clerks or burn a number if the insert rolled back. Keeping the fix in one exported fragment means the three ledgers cannot drift apart again, and both interpolated arguments are code constants, never request data. Aligning the seed's cycle key with the runtime format matters because idempotency is only as good as the key: a seeded invoice with a different key shape for the same cycle date would slip past the engine's lookup and be rejected later by `UNIQUE(subscription_id, billing_cycle_date)` as an opaque database error rather than a clean "already billed" skip.

**Likely Evaluator Q&A**

1. *Why not `to_char(nextval(seq), 'FM0000')`?* — For a value wider than the format mask, `to_char` returns `'####'`, which is a worse failure than truncation because every later document would collide at once. Padding in SQL with `lpad(..., GREATEST(4, length(...)))` widens the number instead of losing digits.

2. *After the first Billing Day run, why does a second run report zero generated and zero skipped?* — The engine only loads contracts whose `next_billing_date <= TODAY`, and the first run advanced every due contract past today, so the second run had nothing to evaluate. Idempotency is proven separately: the run never produced a second invoice for an existing `(subscription_id, billing_cycle_date)` pair, which the suite asserts directly in SQL.

