import { PASSWORD_MIN_LENGTH } from '@lead/schema';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiRequest } from '../../auth/api';
import { useAuth } from '../../auth/session';
import { field, FormMessage, SubmitButton, TextField, useFormAction } from '../../components/form';
import { AuthLayout } from './AuthLayout';

const PASSWORD_HINT = `At least ${PASSWORD_MIN_LENGTH} characters. A short sentence is easy to remember.`;

interface MessageResponse {
  readonly message: string;
}

function BackToSignIn() {
  return (
    <p className="mt-6 text-sm">
      <Link to="/" className="link">
        Back to sign in
      </Link>
    </p>
  );
}

/** The emailed links carry their token after #, so it never reaches server logs. */
export function tokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token && token.length > 0 ? token : null;
}

/** H02: request an account. The password is chosen later, from the confirmation email. */
export function RegisterPage() {
  const [sent, setSent] = useState<string | null>(null);
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    const response = await apiRequest<MessageResponse>('/auth/register', {
      body: {
        email: field(form, 'email'),
        displayName: field(form, 'displayName'),
        role: field(form, 'role'),
      },
    });
    setSent(response.message);
  });

  return (
    <AuthLayout
      title="Request an account"
      description="We email you a link to confirm your address and choose a password. An administrator then approves the account."
    >
      {sent ? (
        <FormMessage tone="success">{sent}</FormMessage>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <TextField label="Full name" name="displayName" autoComplete="name" required />
          <TextField label="Email" name="email" type="email" autoComplete="email" required />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">I am a</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="role" value="student" defaultChecked /> Student
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="role" value="teacher" /> Teacher
            </label>
          </fieldset>
          <SubmitButton busy={busy}>{busy ? 'Sending…' : 'Request account'}</SubmitButton>
        </form>
      )}
      <BackToSignIn />
    </AuthLayout>
  );
}

interface TokenPasswordPageProps {
  readonly hash: string;
  readonly kind: 'confirm' | 'reset';
  readonly path: '/confirm-email' | '/reset-password';
}

/** Confirm email (after H02) and reset password (H03): both set a password from a link. */
export function TokenPasswordPage({ hash, kind, path }: TokenPasswordPageProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  // Read once, then removed from the address bar and history; the page keeps it in state.
  const [token] = useState(() => tokenFromHash(hash));
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (tokenFromHash(hash)) void navigate({ to: path, hash: '', replace: true });
  }, [hash, navigate, path]);
  const { busy, error, setError, onSubmit } = useFormAction(async (form) => {
    const password = field(form, 'password');
    if (password !== field(form, 'confirm')) {
      setError('The two passwords do not match.');
      return;
    }
    if (kind === 'confirm') {
      const response = await apiRequest<MessageResponse>('/auth/email/verify', {
        body: { token, password },
      });
      setDone(response.message);
    } else {
      await apiRequest('/auth/password/reset', { body: { token, password } });
      if (auth.getSnapshot().status === 'signed-in') auth.endLocalSession(true);
      setDone('Your password has been changed and every device was signed out. Sign in again.');
    }
  });

  const title = kind === 'confirm' ? 'Confirm your account' : 'Choose a new password';
  if (!token) {
    return (
      <AuthLayout title={title}>
        <FormMessage tone="error">
          This link is incomplete. Open it again from your email, or request a new one.
        </FormMessage>
        <BackToSignIn />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={title}
      description={kind === 'confirm' ? 'Choose the password for your new account.' : undefined}
    >
      {done ? (
        <FormMessage tone="success">{done}</FormMessage>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <TextField
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            hint={PASSWORD_HINT}
            required
          />
          <TextField
            label="Repeat the password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
          />
          <SubmitButton busy={busy}>{busy ? 'Saving…' : 'Save password'}</SubmitButton>
        </form>
      )}
      <BackToSignIn />
    </AuthLayout>
  );
}

/** H03: ask for a reset link. */
export function ForgotPasswordPage() {
  const [sent, setSent] = useState<string | null>(null);
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    const response = await apiRequest<MessageResponse>('/auth/password/forgot', {
      body: { email: field(form, 'email') },
    });
    setSent(response.message);
  });

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter your account email and we will send you a link to choose a new password."
    >
      {sent ? (
        <FormMessage tone="success">{sent}</FormMessage>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {error && <FormMessage tone="error">{error}</FormMessage>}
          <TextField label="Email" name="email" type="email" autoComplete="email" required />
          <SubmitButton busy={busy}>{busy ? 'Sending…' : 'Send reset link'}</SubmitButton>
        </form>
      )}
      <BackToSignIn />
    </AuthLayout>
  );
}
