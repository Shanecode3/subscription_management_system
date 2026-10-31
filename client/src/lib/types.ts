export type Role = 'ADMIN' | 'STAFF' | 'CUSTOMER';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  companyName: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  token: string;
  user: User;
}

export interface SignupPayload {
  name: string;
  email: string;
  password: string;
  phone?: string;
  companyName?: string;
}

export interface ForgotPasswordResult {
  resetToken?: string;
  resetUrl?: string;
  expiresAt?: string;
}

// ---------------------------------------------------------------------------
// Catalog, plans and quotation templates (Milestone 2)
// ---------------------------------------------------------------------------

export type ProductType = 'Software' | 'Service' | 'Add-on';

export type BillingInterval = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface ProductVariant {
  id: number;
  attributeName: string;
  attributeValue: string;
  priceExtra: number;
  /** salesPrice + priceExtra — the unit price a quotation line uses. */
  price: number;
  sku: string | null;
}

export interface Product {
  id: number;
  name: string;
  type: ProductType;
  salesPrice: number;
  costPrice: number;
  notes: string | null;
  isActive: boolean;
  variants: ProductVariant[];
  createdAt: string;
  updatedAt: string;
}

export interface Plan {
  id: number;
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
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateLine {
  id: number;
  productId: number;
  productName: string;
  variantId: number | null;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface QuotationTemplate {
  id: number;
  name: string;
  planId: number;
  planName: string;
  planBillingInterval: BillingInterval;
  validityDays: number;
  notes: string | null;
  lines: TemplateLine[];
  lineCount: number;
  totalValue: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Subscriptions and the customer portal (Milestone 3)
// ---------------------------------------------------------------------------

export type SubscriptionStatus =
  | 'Draft'
  | 'Quotation'
  | 'Confirmed'
  | 'Active'
  | 'Paused'
  | 'Closed';

export type PaymentTerms =
  | 'Immediate Payment'
  | 'Net 15'
  | 'Net 30'
  | 'Net 45'
  | 'Net 60';

export interface SubscriptionLine {
  id: number;
  productId: number;
  productName: string;
  productType: string;
  variantId: number | null;
  variantLabel: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  subtotal: number;
  totalAmount: number;
  isAddon: boolean;
  isAddonActive: boolean;
}

export interface SubscriptionFlags {
  autoClose: boolean;
  allowEarlyClose: boolean;
  allowPause: boolean;
  allowRenew: boolean;
}

export interface Subscription {
  id: number;
  subscriptionNumber: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  planId: number;
  planName: string;
  planPrice: number;
  billingInterval: BillingInterval;
  templateId: number | null;
  templateName: string | null;
  status: SubscriptionStatus;
  startDate: string;
  expiryDate: string | null;
  nextBillingDate: string | null;
  paymentTerms: PaymentTerms;
  notes: string | null;
  pausedAt: string | null;
  closedAt: string | null;
  flags: SubscriptionFlags;
  allowedTransitions: SubscriptionStatus[];
  lines: SubscriptionLine[];
  subtotal: number;
  addonTotal: number;
  total: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Billing, invoices, taxes and discounts (Milestone 4)
// ---------------------------------------------------------------------------

export interface TaxRule {
  id: number;
  name: string;
  /** Percentage, two decimals: 18 means 18%. */
  rate: number;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
}

export type DiscountType = 'percentage' | 'fixed';
export type DiscountScope = 'whole_subscription' | 'specific_product';
export type DiscountStanding = 'Active' | 'Scheduled' | 'Expired' | 'Exhausted' | 'Inactive';

export interface DiscountRule {
  id: number;
  name: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  scope: DiscountScope;
  targetProductId: number | null;
  targetProductName: string | null;
  minPurchaseAmount: number;
  minQuantity: number;
  startDate: string;
  endDate: string;
  maxUses: number;
  currentUses: number;
  usesRemaining: number;
  isActive: boolean;
  standing: DiscountStanding;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export type InvoiceStatus = 'Draft' | 'Confirmed' | 'Paid' | 'Cancelled';
export type InvoiceAction = 'confirm' | 'cancel' | 'send' | 'print';

export interface InvoiceLine {
  id: number;
  productId: number;
  productName: string;
  variantId: number | null;
  variantLabel: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  taxName: string | null;
  taxRate: number;
  discountCode: string | null;
}

export interface Invoice {
  id: number;
  invoiceNumber: string;
  subscriptionId: number;
  subscriptionNumber: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  customerCompany: string | null;
  customerAddress: string | null;
  planName: string;
  paymentTerms: PaymentTerms;
  billingCycleDate: string;
  billingCycleKey: string;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  totalAmount: number;
  amountPaid: number;
  balanceDue: number;
  isOverdue: boolean;
  daysOverdue: number;
  sentAt: string | null;
  cancelledAt: string | null;
  notes: string | null;
  allowedActions: InvoiceAction[];
  lines: InvoiceLine[];
  createdAt: string;
  updatedAt: string;
}

export interface BillingDueItem {
  subscriptionId: number;
  subscriptionNumber: string;
  customerId: number;
  customerName: string;
  customerEmail: string;
  planName: string;
  billingInterval: BillingInterval;
  paymentTerms: PaymentTerms;
  nextBillingDate: string;
  expiryDate: string | null;
  lineCount: number;
  subtotal: number;
  discountAmount: number;
  discountCode: string | null;
  discountName: string | null;
  taxName: string | null;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  closesOnExpiry: boolean;
}

export interface BillingClosingItem {
  subscriptionId: number;
  subscriptionNumber: string;
  expiryDate: string;
}

export interface BillingPreview {
  asOf: string;
  dueCount: number;
  dueTotal: number;
  items: BillingDueItem[];
  closingCount: number;
  closing: BillingClosingItem[];
}

export interface BillingInvoiceSummary {
  invoiceId: number;
  invoiceNumber: string;
  subscriptionId: number;
  subscriptionNumber: string;
  customerName: string;
  subtotal: number;
  discountTotal: number;
  discountCode: string | null;
  taxTotal: number;
  totalAmount: number;
}

export interface BillingRunResult {
  ranAt: string;
  totalEvaluated: number;
  generatedCount: number;
  skippedCount: number;
  failedCount: number;
  closedCount: number;
  invoices: BillingInvoiceSummary[];
  skipped: { subscriptionId: number; subscriptionNumber: string; reason: string }[];
  failures: { subscriptionId: number; subscriptionNumber: string; message: string }[];
  closed: BillingClosingItem[];
}
