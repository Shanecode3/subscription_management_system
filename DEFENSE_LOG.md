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
