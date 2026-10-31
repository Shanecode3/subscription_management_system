import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { toFieldErrors } from '../utils/validators';
import { ValidationError } from '../utils/errors';

/**
 * Express 4 does not catch rejected promises from async handlers. Without this
 * wrapper a thrown service error becomes a request that never responds.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

function summarise(details: { field: string; message: string }[]): string {
  const fields = new Set(details.map((detail) => detail.field));
  if (fields.size === 1) {
    return details.map((detail) => detail.message).join(' ');
  }
  return 'Please fix the highlighted fields and try again.';
}

export function validateBody<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});

    if (!result.success) {
      const details = toFieldErrors(result.error);
      return next(new ValidationError(summarise(details), details));
    }

    // Replace the raw body with the parsed, trimmed, typed value so services
    // never see unvalidated input.
    req.body = result.data;
    next();
  };
}
