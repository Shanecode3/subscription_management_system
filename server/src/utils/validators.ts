import { z } from 'zod';
import type { FieldError } from './errors';

/** Minimum length is 9 — strictly more than 8 characters. */
export const PASSWORD_MIN_LENGTH = 9;

/** The rule from the brief, kept in one place so front and back end agree. */
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[^a-zA-Z0-9]).{9,}$/;

/**
 * Returns every rule the password breaks, not just the first one, so the user
 * can fix the whole password in a single attempt.
 */
export function describePasswordFailures(password: string): FieldError[] {
  const failures: FieldError[] = [];

  if (/\s/.test(password)) {
    failures.push({ field: 'password', message: 'Password must not contain spaces or tabs.' });
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    failures.push({
      field: 'password',
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`,
    });
  }
  if (!/[a-z]/.test(password)) {
    failures.push({
      field: 'password',
      message: 'Password must include at least one lowercase letter.',
    });
  }
  if (!/[A-Z]/.test(password)) {
    failures.push({
      field: 'password',
      message: 'Password must include at least one uppercase letter.',
    });
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    failures.push({
      field: 'password',
      message: 'Password must include at least one special character (for example ! @ # $ %).',
    });
  }

  return failures;
}

const emailField = z
  .string({ required_error: 'Email address is required.' })
  .trim()
  .min(1, 'Email address is required.')
  .max(255, 'Email address must be 255 characters or fewer.')
  .email('Enter a valid email address, for example name@company.com.');

const nameField = z
  .string({ required_error: 'Full name is required.' })
  .trim()
  .min(2, 'Full name must be at least 2 characters.')
  .max(255, 'Full name must be 255 characters or fewer.');

const phoneField = z
  .string()
  .trim()
  .max(50, 'Phone number must be 50 characters or fewer.')
  .regex(
    /^[0-9+\-\s()]{7,50}$/,
    'Enter a valid phone number using digits, spaces, +, - or parentheses.',
  );

/** Password field that reports every broken rule at once. */
const passwordField = z
  .string({ required_error: 'Password is required.' })
  .superRefine((value, ctx) => {
    for (const failure of describePasswordFailures(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: failure.message });
    }
  });

export const signupSchema = z
  .object({
    name: nameField,
    email: emailField,
    password: passwordField,
    phone: phoneField.optional(),
    companyName: z.string().trim().max(255, 'Company name must be 255 characters or fewer.').optional(),
    address: z.string().trim().max(1000, 'Address must be 1000 characters or fewer.').optional(),
    // Accepted explicitly so we can reject it: role escalation via signup body
    // is a classic attack, and a clear 400 beats a silent downgrade.
    role: z.literal('CUSTOMER', {
      errorMap: () => ({
        message: 'Self-signup always creates a CUSTOMER account. Only an Admin can create staff accounts.',
      }),
    }).optional(),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailField,
    password: z.string({ required_error: 'Password is required.' }).min(1, 'Password is required.'),
  })
  .strict();

export const forgotPasswordSchema = z.object({ email: emailField }).strict();

export const resetPasswordSchema = z
  .object({
    token: z
      .string({ required_error: 'Password reset token is required.' })
      .trim()
      .min(16, 'This password reset link is not valid. Please request a new one.'),
    newPassword: passwordField,
  })
  .strict();

export const createStaffSchema = z
  .object({
    name: nameField,
    email: emailField,
    password: passwordField,
    phone: phoneField.optional(),
  })
  .strict();

export const MIN_PASSWORD_ISSUE_CODE = 'PASSWORD_RULE_VIOLATION';

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

/** Flattens a ZodError into the `details` array of the API error envelope. */
export function toFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    message: issue.message,
  }));
}
