import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { closePool, pool, withTransaction } from './pool';
import { logger } from '../utils/logger';
import type { UserRole } from '../utils/jwt';
import type { BillingInterval, ProductType } from '../utils/catalog.validators';

interface SeedAccount {
  name: string;
  email: string;
  role: UserRole;
  companyName: string | null;
  phone: string | null;
}

interface SeedVariant {
  attributeName: string;
  attributeValue: string;
  priceExtra: number;
  sku: string | null;
}

interface SeedProduct {
  name: string;
  type: ProductType;
  salesPrice: number;
  costPrice: number;
  notes: string;
  variants: SeedVariant[];
}

interface SeedPlan {
  name: string;
  price: number;
  billingInterval: BillingInterval;
  minQuantity: number;
  availableFrom: string;
  availableTo: string | null;
  autoClose: boolean;
  allowEarlyClose: boolean;
  allowPause: boolean;
  allowRenew: boolean;
}

interface SeedTemplateLine {
  productName: string;
  /** Attribute pair identifying the variant, when the line uses one. */
  variant?: { attributeName: string; attributeValue: string };
  quantity: number;
}

interface SeedTemplate {
  name: string;
  planName: string;
  validityDays: number;
  notes: string;
  lines: SeedTemplateLine[];
}

/** Demo password satisfies the 9+ / upper / lower / special rule. */
const SEED_PASSWORD = 'Brightloop@2026';

const SEED_ACCOUNTS: SeedAccount[] = [
  {
    name: 'Aanya Sharma',
    email: 'admin@brightloop.com',
    role: 'ADMIN',
    companyName: 'Brightloop Software',
    phone: '+91 98200 11001',
  },
  {
    name: 'Rohan Mehta',
    email: 'staff@brightloop.com',
    role: 'STAFF',
    companyName: 'Brightloop Software',
    phone: '+91 98200 11002',
  },
  {
    name: 'Priya Nair',
    email: 'customer@brightloop.com',
    role: 'CUSTOMER',
    companyName: 'Nair Retail Group',
    phone: '+91 98200 11003',
  },
];

const SEED_PRODUCTS: SeedProduct[] = [
  {
    name: 'Brightloop Enterprise ERP',
    type: 'Software',
    salesPrice: 1200.0,
    costPrice: 420.0,
    notes: 'Full ERP suite covering accounting, inventory and manufacturing. Priced per named user.',
    variants: [
      {
        attributeName: 'Brand',
        attributeValue: 'Odoo',
        priceExtra: 560.0,
        sku: 'BL-ERP-ODOO',
      },
      {
        attributeName: 'Brand',
        attributeValue: 'Brightloop',
        priceExtra: 0.0,
        sku: 'BL-ERP-STD',
      },
    ],
  },
  {
    name: 'Cloud Infrastructure Add-on',
    type: 'Add-on',
    salesPrice: 150.0,
    costPrice: 60.0,
    notes: 'Managed hosting, nightly backups and uptime monitoring for one environment.',
    variants: [],
  },
  {
    name: 'Priority Support 24/7',
    type: 'Service',
    salesPrice: 300.0,
    costPrice: 120.0,
    notes: 'Round-the-clock support with a one-hour response target for production incidents.',
    variants: [],
  },
];

const SEED_PLANS: SeedPlan[] = [
  {
    name: 'Monthly Pro',
    price: 1200.0,
    billingInterval: 'monthly',
    minQuantity: 1,
    availableFrom: '2026-01-01',
    availableTo: null,
    autoClose: false,
    allowEarlyClose: true,
    allowPause: true,
    allowRenew: true,
  },
  {
    name: 'Annual Enterprise',
    price: 11500.0,
    billingInterval: 'yearly',
    minQuantity: 5,
    availableFrom: '2026-01-01',
    availableTo: null,
    autoClose: true,
    allowEarlyClose: false,
    allowPause: false,
    allowRenew: true,
  },
  {
    name: 'Flexible Daily Trial',
    price: 35.0,
    billingInterval: 'daily',
    minQuantity: 1,
    availableFrom: '2026-01-01',
    availableTo: null,
    autoClose: true,
    allowEarlyClose: true,
    allowPause: true,
    allowRenew: false,
  },
  {
    name: 'Weekly Growth',
    price: 320.0,
    billingInterval: 'weekly',
    minQuantity: 2,
    availableFrom: '2026-01-01',
    availableTo: null,
    autoClose: false,
    allowEarlyClose: true,
    allowPause: false,
    allowRenew: true,
  },
];

const SEED_TEMPLATES: SeedTemplate[] = [
  {
    name: 'Enterprise Monthly Starter',
    planName: 'Monthly Pro',
    validityDays: 30,
    notes: 'Standard entry point for mid-market customers. Uses the Odoo-branded ERP licence.',
    lines: [
      {
        productName: 'Brightloop Enterprise ERP',
        variant: { attributeName: 'Brand', attributeValue: 'Odoo' },
        quantity: 2,
      },
      { productName: 'Cloud Infrastructure Add-on', quantity: 1 },
      { productName: 'Priority Support 24/7', quantity: 1 },
    ],
  },
  {
    name: 'Annual Enterprise Rollout',
    planName: 'Annual Enterprise',
    validityDays: 45,
    notes: 'Volume rollout for enterprise accounts, priced for ten named users.',
    lines: [
      {
        productName: 'Brightloop Enterprise ERP',
        variant: { attributeName: 'Brand', attributeValue: 'Brightloop' },
        quantity: 10,
      },
      { productName: 'Priority Support 24/7', quantity: 10 },
    ],
  },
  {
    name: 'Support Renewal Bundle',
    planName: 'Monthly Pro',
    validityDays: 14,
    notes: 'Renewal quote for customers who keep only the support retainer.',
    lines: [{ productName: 'Priority Support 24/7', quantity: 1 }],
  },
];

async function seedAccounts(): Promise<number> {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, env.bcryptRounds);
  let inserted = 0;

  for (const account of SEED_ACCOUNTS) {
    // ON CONFLICT with no target covers both the email constraint and the
    // case-insensitive unique index, so re-running the seed is always safe.
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, company_name, phone)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        account.name,
        account.email,
        passwordHash,
        account.role,
        account.companyName,
        account.phone,
      ],
    );
    if ((result.rowCount ?? 0) > 0) inserted += 1;
  }

  return inserted;
}

async function ensureProduct(product: SeedProduct): Promise<void> {
  // Select-then-insert keeps a re-run a genuine no-op (no rewritten updated_at).
  const existing = await pool.query<{ id: number }>('SELECT id FROM products WHERE name = $1', [
    product.name,
  ]);

  let productId = existing.rows[0]?.id;
  if (productId === undefined) {
    const created = await pool.query<{ id: number }>(
      `INSERT INTO products (name, type, sales_price, cost_price, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [product.name, product.type, product.salesPrice, product.costPrice, product.notes],
    );
    productId = created.rows[0]!.id;
  }

  for (const variant of product.variants) {
    await pool.query(
      `INSERT INTO product_variants (product_id, attribute_name, attribute_value, price_extra, sku)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (product_id, attribute_name, attribute_value) DO NOTHING`,
      [productId, variant.attributeName, variant.attributeValue, variant.priceExtra, variant.sku],
    );
  }
}

async function ensurePlan(plan: SeedPlan): Promise<void> {
  await pool.query(
    `INSERT INTO subscription_plans (
       name, price, billing_interval, min_quantity, available_from, available_to,
       auto_close, allow_early_close, allow_pause, allow_renew
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (name) DO NOTHING`,
    [
      plan.name,
      plan.price,
      plan.billingInterval,
      plan.minQuantity,
      plan.availableFrom,
      plan.availableTo,
      plan.autoClose,
      plan.allowEarlyClose,
      plan.allowPause,
      plan.allowRenew,
    ],
  );
}

/**
 * Resolves a template line against the freshly seeded catalog and applies the
 * same pricing rule the API uses: unit price = product price + variant surcharge.
 */
async function resolveTemplateLine(line: SeedTemplateLine): Promise<{
  productId: number;
  variantId: number | null;
  unitPrice: string;
}> {
  const product = await pool.query<{ id: number; sales_price: string }>(
    'SELECT id, sales_price FROM products WHERE name = $1',
    [line.productName],
  );
  const productRow = product.rows[0];
  if (!productRow) {
    throw new Error(`Seed template references unknown product "${line.productName}".`);
  }

  if (!line.variant) {
    return { productId: productRow.id, variantId: null, unitPrice: productRow.sales_price };
  }

  const variant = await pool.query<{ id: number; price_extra: string }>(
    `SELECT id, price_extra
       FROM product_variants
      WHERE product_id = $1 AND attribute_name = $2 AND attribute_value = $3`,
    [productRow.id, line.variant.attributeName, line.variant.attributeValue],
  );
  const variantRow = variant.rows[0];
  if (!variantRow) {
    throw new Error(
      `Seed template references unknown variant "${line.variant.attributeName}: ${line.variant.attributeValue}".`,
    );
  }

  return {
    productId: productRow.id,
    variantId: variantRow.id,
    unitPrice: (Number.parseFloat(productRow.sales_price) + Number.parseFloat(variantRow.price_extra)).toFixed(2),
  };
}

async function ensureTemplate(template: SeedTemplate): Promise<boolean> {
  const existing = await pool.query('SELECT id FROM quotation_templates WHERE name = $1', [
    template.name,
  ]);
  if (existing.rowCount) return false;

  const plan = await pool.query<{ id: number }>(
    'SELECT id FROM subscription_plans WHERE name = $1',
    [template.planName],
  );
  const planId = plan.rows[0]?.id;
  if (planId === undefined) {
    throw new Error(`Seed template references unknown plan "${template.planName}".`);
  }

  const lines = await Promise.all(
    template.lines.map(async (line) => ({
      ...(await resolveTemplateLine(line)),
      quantity: line.quantity,
    })),
  );

  await withTransaction(async (client) => {
    const created = await client.query<{ id: number }>(
      `INSERT INTO quotation_templates (name, plan_id, validity_days, notes)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [template.name, planId, template.validityDays, template.notes],
    );
    const templateId = created.rows[0]!.id;

    for (const line of lines) {
      await client.query(
        `INSERT INTO quotation_template_lines (template_id, product_id, variant_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [templateId, line.productId, line.variantId, line.quantity, line.unitPrice],
      );
    }
  });

  return true;
}

async function main(): Promise<void> {
  const newAccounts = await seedAccounts();

  for (const product of SEED_PRODUCTS) await ensureProduct(product);
  for (const plan of SEED_PLANS) await ensurePlan(plan);

  let newTemplates = 0;
  for (const template of SEED_TEMPLATES) {
    if (await ensureTemplate(template)) newTemplates += 1;
  }

  const counts = await pool.query<{
    users: string;
    products: string;
    variants: string;
    plans: string;
    templates: string;
    template_lines: string;
  }>(`
    SELECT
      (SELECT COUNT(*)::text FROM users)                     AS users,
      (SELECT COUNT(*)::text FROM products)                  AS products,
      (SELECT COUNT(*)::text FROM product_variants)          AS variants,
      (SELECT COUNT(*)::text FROM subscription_plans)        AS plans,
      (SELECT COUNT(*)::text FROM quotation_templates)       AS templates,
      (SELECT COUNT(*)::text FROM quotation_template_lines)  AS template_lines
  `);

  const row = counts.rows[0]!;
  logger.info(
    `Seed complete: ${newAccounts} new account(s), ${newTemplates} new template(s).`,
  );

  console.log('Demo accounts (password for all three): ' + SEED_PASSWORD);
  for (const account of SEED_ACCOUNTS) {
    console.log(`  - ${account.role.padEnd(8)} ${account.email}`);
  }

  console.log(
    `Catalog: ${row.products} products, ${row.variants} variants, ${row.plans} plans, ` +
      `${row.templates} templates with ${row.template_lines} lines.`,
  );
}

main()
  .catch((error: unknown) => {
    logger.error('Seeding failed', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
