import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AuthLayout } from '../../components/layout/AuthLayout';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PasswordChecklist } from '../../components/ui/PasswordChecklist';
import { TextField } from '../../components/ui/TextField';
import { ApiError, apiRequest } from '../../lib/api';

export function ResetPasswordPage() {
  const location = useLocation();
  const token = new URLSearchParams(location.search).get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    if (!newPassword) {
      setFieldErrors({ password: 'Choose a new password.' });
      setFormError('Choose a new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirmPassword: 'Passwords do not match.' });
      setFormError('The two passwords do not match.');
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      await apiRequest('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword },
      });
      setIsComplete(true);
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        setFieldErrors(error.fieldErrors());
      } else {
        setFormError('Something went wrong while updating your password. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Choose a password that meets every requirement below."
      footer={
        <Link to="/login" className="font-semibold text-plum-700 hover:text-plum-800">
          Back to sign in
        </Link>
      }
    >
      {!token ? (
        <div className="space-y-4">
          <Alert tone="error" title="Missing reset link">
            This page needs a valid reset token. Request a fresh link and open it from your email.
          </Alert>
          <Link to="/forgot-password" className="btn-primary w-full">
            Request a new link
          </Link>
        </div>
      ) : isComplete ? (
        <div className="space-y-4">
          <Alert tone="success" title="Password updated">
            Your password has been changed. Sign in with your new password.
          </Alert>
          <Link to="/login" className="btn-primary w-full">
            Continue to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {formError ? <Alert tone="error">{formError}</Alert> : null}

          <TextField
            id="newPassword"
            label="New password"
            type="password"
            autoComplete="new-password"
            placeholder="Create a strong password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            error={fieldErrors.password}
            required
          />

          <PasswordChecklist password={newPassword} />

          <TextField
            id="confirmPassword"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter your new password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            error={fieldErrors.confirmPassword}
            required
          />

          <Button type="submit" isLoading={isSubmitting}>
            {isSubmitting ? 'Updating password…' : 'Update password'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
