-- ============================================================================
-- Brightloop Software — Subscription Management Platform
-- Local PostgreSQL 18 Production Schema (3rd Normal Form)
--
-- Idempotent: safe to re-run. Every object uses IF NOT EXISTS and every
-- trigger is dropped before being recreated.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Shared helpers
-- ---------------------------------------------------------------------------

-- Single source of truth for updated_at. Keeping this in the database means no
-- application code path can ever forget to stamp a row.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 1. Human-readable document numbering
--    Sequences are transactional-safe and race-free under concurrent inserts.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS seq_subscription_number START WITH 1001 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_invoice_number      START WITH 1001 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS seq_payment_number      START WITH 1001 INCREMENT BY 1;

-- ---------------------------------------------------------------------------
-- 2. users — authentication identity + RBAC role
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                 SERIAL PRIMARY KEY,
    name               VARCHAR(255) NOT NULL,
    email              VARCHAR(255) NOT NULL,
    password_hash      VARCHAR(255) NOT NULL,
    role               VARCHAR(50)  NOT NULL CHECK (role IN ('ADMIN', 'STAFF', 'CUSTOMER')),
    phone              VARCHAR(50),
    company_name       VARCHAR(255),
    address            TEXT,
    reset_token        VARCHAR(255),
    reset_token_expiry TIMESTAMPTZ,
    is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT chk_users_name_not_blank CHECK (length(btrim(name)) > 0),
    CONSTRAINT chk_users_reset_pair CHECK (
        (reset_token IS NULL AND reset_token_expiry IS NULL)
        OR (reset_token IS NOT NULL AND reset_token_expiry IS NOT NULL)
    )
);

-- Case-insensitive uniqueness is enforced in the database, not only in the
-- application: "Shane@x.com" and "shane@x.com" are the same human.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. products
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255)   NOT NULL,
    type        VARCHAR(50)    NOT NULL CHECK (type IN ('Software', 'Service', 'Add-on')),
    sales_price NUMERIC(12,2)  NOT NULL CHECK (sales_price >= 0),
    cost_price  NUMERIC(12,2)  NOT NULL DEFAULT 0.00 CHECK (cost_price >= 0),
    notes       TEXT,
    is_active   BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_products_name UNIQUE (name)
);

-- Milestone 2 upgrade path: a Milestone 1 database predates these constraints.
-- Guarded so this file stays idempotent on both fresh and existing databases.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_products_name') THEN
        ALTER TABLE products ADD CONSTRAINT uq_products_name UNIQUE (name);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_type ON products (type) WHERE is_active = TRUE;

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. product_variants — e.g. Brand = "Odoo" with price_extra = +560
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_variants (
    id              SERIAL PRIMARY KEY,
    product_id      INT          NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    attribute_name  VARCHAR(100) NOT NULL,
    attribute_value VARCHAR(100) NOT NULL,
    price_extra     NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    sku             VARCHAR(100),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_product_variant UNIQUE (product_id, attribute_name, attribute_value),
    CONSTRAINT chk_variant_attribute_not_blank CHECK (
        length(btrim(attribute_name)) > 0 AND length(btrim(attribute_value)) > 0
    ),
    CONSTRAINT chk_variant_price_extra CHECK (price_extra >= 0)
);

-- Milestone 2 upgrade path for databases created before the surcharge rule.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_variant_price_extra') THEN
        ALTER TABLE product_variants
            ADD CONSTRAINT chk_variant_price_extra CHECK (price_extra >= 0);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants (product_id);

-- ---------------------------------------------------------------------------
-- 5. subscription_plans — interval + operational lifecycle flags
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_plans (
    id               SERIAL PRIMARY KEY,
    name             VARCHAR(255)  NOT NULL,
    price            NUMERIC(12,2) NOT NULL CHECK (price >= 0),
    billing_interval VARCHAR(20)   NOT NULL
        CHECK (billing_interval IN ('daily', 'weekly', 'monthly', 'yearly')),
    min_quantity     INT           NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
    available_from   DATE          NOT NULL,
    available_to     DATE,
    auto_close       BOOLEAN       NOT NULL DEFAULT FALSE,
    allow_early_close BOOLEAN      NOT NULL DEFAULT TRUE,
    allow_pause      BOOLEAN       NOT NULL DEFAULT TRUE,
    allow_renew      BOOLEAN       NOT NULL DEFAULT TRUE,
    is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_plan_availability_dates CHECK (
        available_to IS NULL OR available_to >= available_from
    ),
    CONSTRAINT uq_plans_name UNIQUE (name)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_plans_name') THEN
        ALTER TABLE subscription_plans ADD CONSTRAINT uq_plans_name UNIQUE (name);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_plans_active ON subscription_plans (is_active, billing_interval);

DROP TRIGGER IF EXISTS trg_plans_updated_at ON subscription_plans;
CREATE TRIGGER trg_plans_updated_at
    BEFORE UPDATE ON subscription_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. quotation_templates — offer packages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quotation_templates (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(255)   NOT NULL,
    plan_id       INT            NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
    validity_days INT            NOT NULL DEFAULT 30 CHECK (validity_days > 0),
    notes         TEXT,
    created_at    TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_templates_name UNIQUE (name)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_templates_name') THEN
        ALTER TABLE quotation_templates ADD CONSTRAINT uq_templates_name UNIQUE (name);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_templates_plan ON quotation_templates (plan_id);

DROP TRIGGER IF EXISTS trg_templates_updated_at ON quotation_templates;
CREATE TRIGGER trg_templates_updated_at
    BEFORE UPDATE ON quotation_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. quotation_template_lines
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quotation_template_lines (
    id         SERIAL PRIMARY KEY,
    template_id INT           NOT NULL REFERENCES quotation_templates(id) ON DELETE CASCADE,
    product_id  INT           NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id  INT           REFERENCES product_variants(id) ON DELETE SET NULL,
    quantity    INT           NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price  NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_template_lines_template ON quotation_template_lines (template_id);
CREATE INDEX IF NOT EXISTS idx_template_lines_product  ON quotation_template_lines (product_id);

-- ---------------------------------------------------------------------------
-- 8. tax_rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tax_rules (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(100)  NOT NULL,
    rate       NUMERIC(5,2)  NOT NULL CHECK (rate >= 0 AND rate <= 100),
    is_active  BOOLEAN       NOT NULL DEFAULT TRUE,
    is_default BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- At most one default tax rule may exist at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_rules_single_default
    ON tax_rules (is_default) WHERE is_default = TRUE;

-- ---------------------------------------------------------------------------
-- 9. discount_rules — Admin-authored only
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discount_rules (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(255)  NOT NULL,
    code                VARCHAR(50)   NOT NULL,
    discount_type       VARCHAR(20)   NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value      NUMERIC(12,2) NOT NULL CHECK (discount_value > 0),
    scope               VARCHAR(30)   NOT NULL
        CHECK (scope IN ('whole_subscription', 'specific_product')),
    target_product_id   INT           REFERENCES products(id) ON DELETE SET NULL,
    min_purchase_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (min_purchase_amount >= 0),
    min_quantity        INT           NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
    start_date          DATE          NOT NULL,
    end_date            DATE          NOT NULL,
    max_uses            INT           NOT NULL DEFAULT 100 CHECK (max_uses > 0),
    current_uses        INT           NOT NULL DEFAULT 0 CHECK (current_uses >= 0),
    is_active           BOOLEAN       NOT NULL DEFAULT TRUE,
    created_by          INT           NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_discount_code UNIQUE (code),
    CONSTRAINT chk_discount_dates CHECK (end_date >= start_date),
    CONSTRAINT chk_discount_scope_target CHECK (
        (scope = 'whole_subscription' AND target_product_id IS NULL)
        OR (scope = 'specific_product' AND target_product_id IS NOT NULL)
    ),
    CONSTRAINT chk_discount_usage CHECK (current_uses <= max_uses),
    CONSTRAINT chk_percentage_cap CHECK (
        discount_type <> 'percentage' OR discount_value <= 100
    )
);

CREATE INDEX IF NOT EXISTS idx_discount_lookup
    ON discount_rules (code, is_active, start_date, end_date);

DROP TRIGGER IF EXISTS trg_discounts_updated_at ON discount_rules;
CREATE TRIGGER trg_discounts_updated_at
    BEFORE UPDATE ON discount_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 10. subscriptions — lifecycle state machine
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
    id                  SERIAL PRIMARY KEY,
    subscription_number VARCHAR(50) NOT NULL,
    customer_id         INT         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    plan_id             INT         NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
    template_id         INT         REFERENCES quotation_templates(id) ON DELETE SET NULL,
    status              VARCHAR(30) NOT NULL DEFAULT 'Draft'
        CHECK (status IN ('Draft', 'Quotation', 'Confirmed', 'Active', 'Paused', 'Closed')),
    start_date          DATE        NOT NULL,
    expiry_date         DATE,
    payment_terms       VARCHAR(100) NOT NULL DEFAULT 'Immediate Payment',
    next_billing_date   DATE,
    discount_rule_id    INT         REFERENCES discount_rules(id) ON DELETE SET NULL,
    tax_rule_id         INT         REFERENCES tax_rules(id) ON DELETE RESTRICT,
    paused_at           TIMESTAMPTZ,
    closed_at           TIMESTAMPTZ,
    -- First moment the contract actually went live. A contract closed before it
    -- ever reached Active was cancelled, not run out, so it cannot be renewed.
    activated_at        TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_subscription_number UNIQUE (subscription_number),
    CONSTRAINT chk_sub_dates CHECK (expiry_date IS NULL OR expiry_date >= start_date)
);

-- Billing Day scan: every due active subscription, no sequential table scan.
CREATE INDEX IF NOT EXISTS idx_subs_active_billing
    ON subscriptions (status, next_billing_date) WHERE status = 'Active';
CREATE INDEX IF NOT EXISTS idx_subs_customer_status
    ON subscriptions (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_subs_plan ON subscriptions (plan_id);

DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Incremental migration for databases created before activated_at existed.
-- The guard makes this a one-time step: once the column is there the block is a
-- no-op, so re-running db:init never stamps a contract that was declined before
-- it started and must stay non-renewable.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'subscriptions'
           AND column_name = 'activated_at'
    ) THEN
        ALTER TABLE subscriptions ADD COLUMN activated_at TIMESTAMPTZ;
        UPDATE subscriptions
           SET activated_at = COALESCE(start_date::timestamptz, updated_at)
         WHERE status IN ('Active', 'Paused', 'Closed');
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 11. subscription_lines
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_lines (
    id               SERIAL PRIMARY KEY,
    subscription_id  INT           NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    product_id       INT           NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id       INT           REFERENCES product_variants(id) ON DELETE SET NULL,
    description      VARCHAR(255)  NOT NULL,
    quantity         INT           NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price       NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    discount_amount  NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
    tax_amount       NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
    subtotal         NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
    total_amount     NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    is_addon         BOOLEAN       NOT NULL DEFAULT FALSE,
    is_addon_active  BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sub_lines_subscription ON subscription_lines (subscription_id);

-- ---------------------------------------------------------------------------
-- 12. invoices — billing_cycle_key is the idempotency guard
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
    id                 SERIAL PRIMARY KEY,
    invoice_number     VARCHAR(50)   NOT NULL,
    subscription_id    INT           NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
    customer_id        INT           NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    billing_cycle_date DATE          NOT NULL,
    billing_cycle_key  VARCHAR(100)  NOT NULL,
    status             VARCHAR(30)   NOT NULL DEFAULT 'Draft'
        CHECK (status IN ('Draft', 'Confirmed', 'Paid', 'Cancelled')),
    issue_date         DATE          NOT NULL DEFAULT CURRENT_DATE,
    due_date           DATE          NOT NULL,
    subtotal           NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (subtotal >= 0),
    tax_total          NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (tax_total >= 0),
    discount_total     NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (discount_total >= 0),
    total_amount       NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
    amount_paid        NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (amount_paid >= 0),
    sent_at            TIMESTAMPTZ,
    cancelled_at       TIMESTAMPTZ,
    notes              TEXT,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_invoice_number UNIQUE (invoice_number),
    CONSTRAINT uq_invoice_billing_cycle UNIQUE (billing_cycle_key),
    CONSTRAINT chk_invoice_dates CHECK (due_date >= issue_date),
    CONSTRAINT chk_invoice_paid_within_total CHECK (amount_paid <= total_amount)
);

CREATE INDEX IF NOT EXISTS idx_invoices_status_due
    ON invoices (status, due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_status
    ON invoices (customer_id, status, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_subscription ON invoices (subscription_id);

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- 13. invoice_lines
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_lines (
    id               SERIAL PRIMARY KEY,
    invoice_id       INT           NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    product_id       INT           NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    variant_id       INT           REFERENCES product_variants(id) ON DELETE SET NULL,
    description      VARCHAR(255)  NOT NULL,
    quantity         INT           NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price       NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    discount_amount  NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
    tax_amount       NUMERIC(12,2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
    total_amount     NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
    -- Snapshots taken at billing time. The rate is copied, not joined, so a
    -- later change to tax_rules never rewrites an invoice already issued.
    tax_rule_id      INT           REFERENCES tax_rules(id) ON DELETE RESTRICT,
    tax_name         VARCHAR(100),
    tax_rate         NUMERIC(5,2)  NOT NULL DEFAULT 0.00 CHECK (tax_rate >= 0 AND tax_rate <= 100),
    discount_rule_id INT           REFERENCES discount_rules(id) ON DELETE SET NULL
);

-- Upgrade path for databases created before the Milestone 4 tax snapshot columns.
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS tax_rule_id INT
    REFERENCES tax_rules(id) ON DELETE RESTRICT;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS tax_name VARCHAR(100);
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS discount_rule_id INT
    REFERENCES discount_rules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_discount ON invoice_lines (discount_rule_id)
    WHERE discount_rule_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 14. payments — append-only ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id             SERIAL PRIMARY KEY,
    payment_number VARCHAR(50)   NOT NULL,
    invoice_id     INT           NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    customer_id    INT           NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(50)   NOT NULL
        CHECK (payment_method IN ('Bank Transfer', 'Credit Card', 'UPI', 'Cash')),
    payment_date   DATE          NOT NULL DEFAULT CURRENT_DATE,
    reference_note TEXT,
    recorded_by    INT           NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_payment_number UNIQUE (payment_number)
);

CREATE INDEX IF NOT EXISTS idx_payments_date_amount ON payments (payment_date, amount);
CREATE INDEX IF NOT EXISTS idx_payments_invoice_id  ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_customer    ON payments (customer_id);

-- ---------------------------------------------------------------------------
-- 15. audit_logs — who did what, to what
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id           SERIAL PRIMARY KEY,
    entity_type  VARCHAR(50) NOT NULL,
    entity_id    INT         NOT NULL,
    action       VARCHAR(50) NOT NULL,
    performed_by INT         REFERENCES users(id) ON DELETE SET NULL,
    details      JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs (entity_type, entity_id, created_at DESC);

COMMIT;
