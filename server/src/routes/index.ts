import { Router } from 'express';
import { isDatabaseReachable } from '../db/pool';
import { asyncHandler } from '../middleware/validate.middleware';
import { sendSuccess } from '../utils/response';
import { authRouter } from './auth.routes';
import { adminRouter } from './admin.routes';
import { productRouter } from './product.routes';
import { planRouter } from './plan.routes';
import { templateRouter } from './template.routes';
import { subscriptionRouter } from './subscription.routes';
import { portalRouter } from './portal.routes';
import { taxRouter } from './tax.routes';
import { discountRouter } from './discount.routes';
import { invoiceRouter } from './invoice.routes';
import { paymentRouter } from './payment.routes';
import { financeRouter } from './finance.routes';
import { billingRouter } from './billing.routes';

export const apiRouter = Router();

apiRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const databaseUp = await isDatabaseReachable();

    if (!databaseUp) {
      return res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message:
            'The API is running but cannot reach PostgreSQL. Check DATABASE_URL in server/.env and confirm the database exists.',
        },
      });
    }

    return sendSuccess(res, {
      status: 'ok',
      database: 'connected',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  }),
);

apiRouter.use('/auth', authRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/plans', planRouter);
apiRouter.use('/quotation-templates', templateRouter);
apiRouter.use('/subscriptions', subscriptionRouter);
apiRouter.use('/tax-rules', taxRouter);
apiRouter.use('/discount-rules', discountRouter);
apiRouter.use('/invoices', invoiceRouter);
apiRouter.use('/payments', paymentRouter);
apiRouter.use('/finance', financeRouter);
apiRouter.use('/billing', billingRouter);
apiRouter.use('/portal', portalRouter);
