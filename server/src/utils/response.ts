import type { Response } from 'express';

/**
 * The uniform success envelope from SPEC section 7:
 *   { "success": true, "data": {...}, "message": "..." }
 */
export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  message?: string,
): Response {
  const body: { success: true; data: T; message?: string } = { success: true, data };
  if (message) body.message = message;
  return res.status(statusCode).json(body);
}
