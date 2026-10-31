# Odoo × Make-A-Ton 9.0 Hackathon — Rules, Grading Rubric & Problem Context

## 1. Mandatory Hackathon Rules & Submission Deadlines

* **Single Branch Rule:** All code must be committed and pushed strictly to the `main` branch. Never leave unmerged work on feature branches.

* **Hourly Commit Cadence:** Code must be pushed to `origin main` at least once every 60 minutes with clear, descriptive conventional commit messages (`feat:`, `fix:`, `refactor:`) explaining what was implemented.

* **Git Identity Matching:** All commits must use the participant's registered GitHub username and email so the portal's automated Q&A bot maps commits to the profile. Never include "Co-Authored-By", "Generated with Claude Code", or any AI attribution trailers in git commit messages.

* **Collaborators (Before 10:00 AM):** Add `hackathon-odoo` and `krip-odoo` (Evaluator: Krishna Patel, `krip@odoo.com`) as collaborators on the public GitHub repository.

* **Coding Cutoff (05:00 PM):** All repository pushes must finish before 05:00 PM IST.

* **Demo Video Cutoff (05:30 PM):** Submit a 5–6 minute open-access video link demonstrating only the live functional flow of the application.

* **Live Q&A Defense (`DEFENSE_LOG.md`):** After completing any database table, backend route, or UI screen, update `DEFENSE_LOG.md` with:

  1. **File & Component:** Path and function/model name.

  2. **How It Works:** Plain-English walkthrough of the logic and data flow.

  3. **Why This Design:** Architectural reason for choosing this schema, validation rule, or query optimization.

  4. **Q&A Defense Answers:** 2 likely technical questions the evaluator bot will ask about this commit, paired with concise 2-sentence answers.

## 2. Official Evaluator Grading Rubric (From Odoo Evaluator Briefing)

1. **Relational Database Design & Setup (Highest Weight):**

   * Must use a local relational SQL database (**PostgreSQL** or **MySQL**).

   * **Strictly Forbidden:** Backend-as-a-Service (BaaS) platforms such as Firebase, Supabase, or MongoDB Atlas.

   * Properly normalized tables with foreign keys, cascading/restrict rules, unique constraints, and composite indexes.

2. **Real-Time Dynamic Data (No Static JSON):**

   * All views, tables, invoices, and dashboard metrics must read and write live SQL database records—never hardcoded static JSON arrays.

3. **Minimal Third-Party API Dependencies:**

   * Build core subscription, tax, discount, billing, and reporting logic from scratch so external API failures cannot break the evaluation.

4. **Robust Input Validation & Graceful Error Handling:**

   * Validate all user inputs on both frontend and backend.

   * Return clear, specific error messages (e.g., invalid email format, password complexity failure, duplicate email, negative quantities, expired discounts).

5. **Interactive, Clean UI & Intuitive Navigation:**

   * Consistent color palette, clear typography, intuitive sidebar/top navigation, status badges, and zero dead links.

6. **Performance & Scalability (< 2 Seconds Rule):**

   * Every page—including the Finance Lead Dashboard with thousands of subscriptions—must respond in **under 2 seconds** using SQL `SUM`/`COUNT` aggregations and indexed columns.

7. **Modularity, Code Quality & Security:**

   * Clean separation of concerns (routes/controllers, services/business logic, database schema, UI components), role-based access middleware, and password hashing.

## 3. Problem Statement Requirements: Subscription Management System (Brightloop Software)

Build a unified subscription, recurring billing, invoicing, payment, and revenue reporting platform for **Brightloop Software** covering these 6 core operational scenes:

### Scene 1: Customer Signup, Auth & Role-Based Access Control (RBAC)

* **Self-Signup Validation:**

  * Email must be globally unique (`UNIQUE` constraint; show clear error if already registered).

  * Password must be **strictly more than 8 characters (9+ characters)** and include at least **1 uppercase letter**, **1 lowercase letter**, and **1 special character** (`^(?=.*[a-z])(?=.*[A-Z])(?=.*[^a-zA-Z0-9]).{9,}$`).

  * **Forgot Password Flow:** Generates a password reset link/token for a registered email and allows setting a new validated password.

* **Three Distinct Roles:**

  * **Admin (`ADMIN`):** Full access to everything. **Only Admin can add a new member of internal staff**, and **only Admin can create discount rules**.

  * **Internal Staff (`STAFF`):** Manages day-to-day quotes, customer subscriptions, billing day invoice runs, and payment recording. Cannot create staff or discount rules.

  * **Customer (`CUSTOMER`):** Logs into a dedicated Customer Portal seeing **only their own subscriptions and invoices**, switching add-ons on/off, and pausing/renewing/closing their subscription early (when permitted by their plan).

### Scene 2: Products, Variants & Subscription Plans

* **Products & Variants:**

  * Admin creates products with `name`, `type` (e.g., `Software`, `Service`, `Add-on`), `sales_price`, `cost_price`, and `notes`.

  * Products support **variants** (e.g., by Brand, where choosing the **Odoo** brand adds **+560** to the base sales price).

* **Subscription Plans:**

  * Admin configures plans with `name`, `price`, `billing_interval` (`daily`, `weekly`, `monthly`, `yearly`), `min_quantity`, and availability window (`available_from`, `available_to`).

  * Plan-level lifecycle flags set by Admin:

    * `auto_close` (closes automatically when the end date is reached)

    * `allow_early_close` (can be closed early)

    * `allow_pause` (can be paused and resumed)

    * `allow_renew` (can be renewed)

### Scene 3: Turning a Quotation Template into a Subscription

* **Quotation Templates:**

  * Pre-configured offer templates with a default `plan`, `validity_days`, and pre-selected `product_lines` (including variants and quantities).

* **Subscription Record & State Machine:**

  * Starting from a template pre-fills the subscription.

  * Fields: unique `subscription_number` (e.g., `SUB-2026-0001`), `customer`, `plan`, `start_date`, `expiry_date`, `payment_terms`, and `lines` (`product`, `variant`, `quantity`, `unit_price`, `taxes`, `discount`, `amount`).

  * **State Machine:** `Draft` -> `Quotation` -> `Confirmed` -> `Active` -> `Closed` (plus `Paused` when `allow_pause` is enabled on the plan). Visual status progression bar visible to the team.

### Scene 4: Billing Day & Automated Invoicing

* **Batch & Single Invoice Generation:**

  * One-click "Billing Day" run generates invoices for all due `Active` subscriptions (`next_billing_date <= TODAY`), automatically copying customer details, product lines, calculated taxes, and applicable discounts.

  * **Zero Double-Billing / Zero Skipped Subscriptions:** Enforce idempotency via a unique billing cycle key (`UNIQUE(subscription_id, billing_cycle_date)`) so no subscription is ever billed twice for the same period.

* **Automatic Taxes & Invoice Actions:**

  * Taxes are calculated automatically from Admin-configured tax rules.

  * Team actions on any invoice: **Confirm**, **Cancel**, **Send**, and **Print** (clean printable layout).

  * **Invoice State Machine:** `Draft` -> `Confirmed` -> `Paid` (or `Cancelled`).

### Scene 5: Admin Discount Rules

* **Admin-Only Discount Creation:**

  * Fixed amount or percentage discount.

  * Conditions: `min_purchase_amount`, `min_quantity`, `start_date`, `end_date`, and `max_uses` (usage limit).

  * Scope: Can apply to **specific products** or to **whole subscriptions**.

* **Automatic Application & Expiry:**

  * Once attached/applicable, the discount automatically appears on the next generated invoice without manual intervention.

  * Automatically stops applying once `TODAY > end_date` or `current_uses >= max_uses`.

### Scene 6: Payments & Finance Lead Dashboard (< 2s Response)

* **Recording Payments:**

  * Record payments against invoices with `method` (`Bank Transfer`, `Credit Card`, `UPI`, `Cash`), `amount`, `date`, and `note`.

  * Automatically updates invoice paid/outstanding status so the team can immediately see paid vs. outstanding/overdue invoices.

* **Finance Lead Summary Dashboard:**

  * Single unified view displaying:

    * **Active Subscriptions** count & recurring revenue (MRR/ARR)

    * **Total Revenue Collected** & **Total Payments**

    * **Total Amount Still Owed (Outstanding)**

    * **Overdue Invoices** list (`due_date < TODAY` and unpaid)

  * Interactive filters (by date range, plan, status, customer).

  * **Performance Benchmark:** Must seed/support thousands of subscription records and respond in **under 2 seconds** on every page.