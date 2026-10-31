export interface FieldError {
  field: string;
  message: string;
}

/**
 * Every expected failure in the API is one of these. The global error handler
 * turns them into the uniform `{ success: false, error: {...} }` envelope, so
 * route handlers only ever throw — they never format error responses.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: FieldError[];

  constructor(statusCode: number, code: string, message: string, details?: FieldError[]) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The submitted data is invalid.', details?: FieldError[]) {
    super(400, 'VALIDATION_FAILED', message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication is required to access this resource.') {
    super(401, 'AUTHENTICATION_REQUIRED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: FieldError[]) {
    super(409, 'CONFLICT', message, details);
  }
}
