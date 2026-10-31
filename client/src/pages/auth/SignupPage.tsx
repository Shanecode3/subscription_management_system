import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthLayout } from '../../components/layout/AuthLayout';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PasswordChecklist } from '../../components/ui/PasswordChecklist';
import { TextField } from '../../components/ui/TextField';
import { ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';

export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '',
    email: '',
    companyName: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);

    const nextFieldErrors: Record<string, string> = {};

    if (!form.name.trim()) nextFieldErrors.name = 'Full name is required.';
    if (!form.email.trim()) nextFieldErrors.email = 'Email address is required.';
    if (!form.password) nextFieldErrors.password = 'Password is required.';
    if (form.password !== form.confirmPassword) {
      nextFieldErrors.confirmPassword = 'Passwords do not match.';
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setFormError('Please correct the highlighted fields.');
      return;
    }

    setFieldErrors({});
    setIsSubmitting(true);

    try {
      await signup({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim() || undefined,
        companyName: form.companyName.trim() || undefined,
      });
      navigate('/', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        setFieldErrors(error.fieldErrors());
      } else {
        setFormError('Something went wrong while creating your account. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Self-signup creates a customer account. Staff accounts are created by an Admin."
      footer={
        <>
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-plum-700 hover:text-plum-800">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {formError ? <Alert tone="error">{formError}</Alert> : null}

        <TextField
          id="name"
          label="Full name"
          autoComplete="name"
          placeholder="Priya Nair"
          value={form.name}
          onChange={update('name')}
          error={fieldErrors.name}
          required
        />

        <TextField
          id="email"
          label="Email address"
          type="email"
          autoComplete="email"
          placeholder="name@company.com"
          value={form.email}
          onChange={update('email')}
          error={fieldErrors.email}
          hint="Used to sign in. Each email address can only be registered once."
          required
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="companyName"
            label="Company"
            autoComplete="organization"
            placeholder="Optional"
            value={form.companyName}
            onChange={update('companyName')}
            error={fieldErrors.companyName}
          />
          <TextField
            id="phone"
            label="Phone"
            type="tel"
            autoComplete="tel"
            placeholder="Optional"
            value={form.phone}
            onChange={update('phone')}
            error={fieldErrors.phone}
          />
        </div>

        <TextField
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="Create a strong password"
          value={form.password}
          onChange={update('password')}
          error={fieldErrors.password}
          required
        />

        <PasswordChecklist password={form.password} />

        <TextField
          id="confirmPassword"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          placeholder="Re-enter your password"
          value={form.confirmPassword}
          onChange={update('confirmPassword')}
          error={fieldErrors.confirmPassword}
          required
        />

        <Button type="submit" isLoading={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
