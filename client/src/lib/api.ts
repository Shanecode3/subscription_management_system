export interface FieldError {
  field: string;
  message: string;
}

interface SuccessEnvelope<T> {
  success: true;
  data: T;
  message?: string;
}

interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: FieldError[];
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: FieldError[];

  constructor(status: number, code: string, message: string, details: FieldError[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /**
   * Turns `details` into a `{ field: message }` map for inline field errors.
   * Multiple rules on one field are joined, so a password that breaks three
   * rules shows all three instead of only the last one.
   */
  fieldErrors(): Record<string, string> {
    return this.details.reduce<Record<string, string>>((accumulator, detail) => {
      const existing = accumulator[detail.field];
      accumulator[detail.field] = existing ? `${existing} ${detail.message}` : detail.message;
      return accumulator;
    }, {});
  }
}

export interface ApiResult<T> {
  data: T;
  message?: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
const REQUEST_TIMEOUT_MS = 15_000;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
}

/**
 * One fetch wrapper for the whole app: adds JSON headers, the bearer token,
 * a timeout, and converts every failure into an `ApiError` with a message that
 * is safe to show to a user.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, 'REQUEST_TIMEOUT', 'The server took too long to respond. Please try again.');
    }
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Cannot reach the Brightloop API. Make sure the backend is running on port 5000.',
    );
  } finally {
    window.clearTimeout(timeout);
  }

  const rawBody = await response.text();
  let parsed: unknown = undefined;
  if (rawBody) {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    const envelope = parsed as ErrorEnvelope | undefined;
    const message =
      envelope?.error?.message ??
      `The server returned an unexpected ${response.status} response. Please try again.`;
    throw new ApiError(
      response.status,
      envelope?.error?.code ?? 'UNEXPECTED_ERROR',
      message,
      envelope?.error?.details ?? [],
    );
  }

  const envelope = parsed as SuccessEnvelope<T> | undefined;
  if (!envelope || envelope.success !== true) {
    throw new ApiError(
      response.status,
      'MALFORMED_RESPONSE',
      'The server returned a response the app could not read. Please try again.',
    );
  }

  return { data: envelope.data, message: envelope.message };
}
