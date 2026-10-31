import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { toFieldErrors } from '../utils/validators';

interface PostgresError {
  code?: string;
  constraint?: string;
  detail?: string;
  type?: string;
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `No API route matches ${req.method} ${req.originalUrl}.`,
    },
  });
};

/**
 * Maps PostgreSQL SQLSTATE codes onto a user-facing message. The raw driver
 * error is never returned, because it leaks table, column and constraint names.
 */
function translateDatabaseError(error: PostgresError): { status: number; code: string; message: string } {
  switch (error.code) {
    case '23505':
      return {
        status: 409,
        code: 'DUPLICATE_RECORD',
        message: 'A record with these details already exists.',
      };
    case '23503':
      return {
        status: 409,
        code: 'RELATED_RECORD_MISSING',
        message: 'This action references a record that does not exist or is still in use.',
      };
    case '23514':
      return {
        status: 400,
        code: 'CONSTRAINT_VIOLATION',
        message: 'One of the submitted values breaks a database rule (for example a negative price or quantity).',
      };
    case '23502':
      return {
        status: 400,
        code: 'MISSING_REQUIRED_FIELD',
        message: 'A required field was missing from the request.',
      };
    case '22P02':
      return {
        status: 400,
        code: 'INVALID_FORMAT',
        message: 'One of the submitted values has an invalid format.',
      };
    default:
      return {
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side. Please try again.',
      };
  }
}

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof AppError) {
    logger.debug(`${req.method} ${req.originalUrl} -> ${error.statusCode} ${error.code}`);
    return res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }

  if (error instanceof ZodError) {
    const details = toFieldErrors(error);
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The submitted data is invalid.',
        details,
      },
    });
  }

  const postgresError = error as PostgresError;

  if (postgresError?.type === 'entity.parse.failed') {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_JSON', message: 'The request body must be valid JSON.' },
    });
  }

  if (postgresError?.code && /^[0-9A-Z]{5}$/.test(postgresError.code)) {
    const translated = translateDatabaseError(postgresError);
    logger.error(`Database error on ${req.method} ${req.originalUrl}`, {
      code: postgresError.code,
      constraint: postgresError.constraint,
    });
    return res.status(translated.status).json({
      success: false,
      error: { code: translated.code, message: translated.message },
    });
  }

  logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, error);

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again.',
      ...(isProduction ? {} : { details: [{ field: 'server', message: String(error?.message ?? error) }] }),
    },
  });
};
