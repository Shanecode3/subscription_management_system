import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AuthLayout } from '../../components/layout/AuthLayout';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { ApiError, apiRequest } from '../../lib/api';
import type { ForgotPasswordResult } from '../../lib/types';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ message: string; resetUrl?: string } | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (!email.trim()) {
      setFormError('Enter the email address you registered with.');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await apiRequest<ForgotPasswordResult>('/auth/forgot-password', {
        method: 'POST',
        body: { email: email.trim() },
      });
      setResult({
        message:
          response.message ??
          'If that email address belongs to an account, a reset link has been generated.',
        resetUrl: response.data.resetUrl,
      });
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : 'Something went wrong while requesting the reset link. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Forgot password"
      subtitle="Request a one-hour reset link for your account."
      footer={
        <Link to="/login" className="font-semibold text-plum-700 hover:text-plum-800">
          Back to sign in
        </Link>
      }
    >
      {result ? (
        <div className="space-y-4">
          <Alert tone="success" title="Reset link generated">
            {result.message}
          </Alert>

          {result.resetUrl ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Development mode
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                No mail server is configured locally, so the link is returned directly:
              </p>
              <a
                href={result.resetUrl}
                className="mt-2 inline-block break-all text-sm font-semibold text-teal-700 underline decoration-teal-300 underline-offset-2 hover:text-teal-800"
              >
                Open reset link
              </a>
            </div>
          ) : null}

          <Button variant="secondary" onClick={() => setResult(null)}>
            Request another link
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {formError ? <Alert tone="error">{formError}</Alert> : null}

          <TextField
            id="email"
            label="Email address"
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <Button type="submit" isLoading={isSubmitting}>
            {isSubmitting ? 'Generating link…' : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
