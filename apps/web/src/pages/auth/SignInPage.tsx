import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuth } from '../../auth/session';
import { field, FormMessage, SubmitButton, TextField, useFormAction } from '../../components/form';
import { AuthLayout } from './AuthLayout';

/** H01 sign-in, followed by H05 (second factor) when the account has MFA on. */
export function SignInPage() {
  const [challengeToken, setChallengeToken] = useState<string | null>(null);

  if (challengeToken) {
    return (
      <SecondFactorStep challengeToken={challengeToken} onCancel={() => setChallengeToken(null)} />
    );
  }
  return <PasswordStep onMfaRequired={setChallengeToken} />;
}

function PasswordStep({ onMfaRequired }: { onMfaRequired: (token: string) => void }) {
  const auth = useAuth();
  // Signing in changes the session; the router then sends the user to their dashboard.
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    const result = await auth.signIn(field(form, 'email'), field(form, 'password'));
    if (result.mfaRequired) onMfaRequired(result.challengeToken);
  });

  return (
    <AuthLayout title="Sign in" description="Use your City College of Calapan account.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <SubmitButton busy={busy}>{busy ? 'Signing in…' : 'Sign in'}</SubmitButton>
      </form>
      <div className="mt-6 flex flex-wrap justify-between gap-2 text-sm">
        <Link to="/forgot-password" className="underline">
          Forgot password?
        </Link>
        <Link to="/register" className="underline">
          Request an account
        </Link>
      </div>
    </AuthLayout>
  );
}

interface SecondFactorStepProps {
  readonly challengeToken: string;
  readonly onCancel: () => void;
}

function SecondFactorStep({ challengeToken, onCancel }: SecondFactorStepProps) {
  const auth = useAuth();
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const { busy, error, setError, onSubmit } = useFormAction(async (form) => {
    const value = field(form, 'factor');
    await auth.verifySecondFactor(
      challengeToken,
      useRecoveryCode ? { recoveryCode: value } : { code: value },
    );
  });

  const toggle = () => {
    setUseRecoveryCode((current) => !current);
    setError(null);
  };

  return (
    <AuthLayout
      title="Two-step verification"
      description={
        useRecoveryCode
          ? 'Enter one of the recovery codes you saved. Each code works once.'
          : 'Enter the 6-digit code from your authenticator app.'
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <TextField
          key={useRecoveryCode ? 'recovery' : 'code'}
          label={useRecoveryCode ? 'Recovery code' : 'Authentication code'}
          name="factor"
          autoComplete="one-time-code"
          inputMode={useRecoveryCode ? 'text' : 'numeric'}
          autoFocus
          required
        />
        <SubmitButton busy={busy}>{busy ? 'Checking…' : 'Verify'}</SubmitButton>
      </form>
      <div className="mt-6 flex flex-wrap justify-between gap-2 text-sm">
        <button type="button" onClick={toggle} className="underline">
          {useRecoveryCode ? 'Use the authenticator app' : 'Use a recovery code'}
        </button>
        <button type="button" onClick={onCancel} className="underline">
          Back to sign in
        </button>
      </div>
    </AuthLayout>
  );
}
