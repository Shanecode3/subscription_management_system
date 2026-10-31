import { Router } from 'express';
import { isDatabaseReachable } from '../db/pool';
import { asyncHandler } from '../middleware/validate.middleware';
import { sendSuccess } from '../utils/response';
import { authRouter } from './auth.routes';
import { adminRouter } from './admin.routes';
import { productRouter } from './product.routes';
import { planRouter } from './plan.routes';
import { templateRouter } from './template.routes';

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
