import type { CurrentUser, MfaEnableResponse, MfaSetupResponse } from '@lead/schema';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/session';
import { SessionsSection } from './SessionsSection';
import {
  field,
  FormMessage,
  SubmitButton,
  TextField,
  useFocusOnMount,
  useFormAction,
} from '../components/form';

interface SecurityPageProps {
  readonly user: CurrentUser;
}

/** H08 account security; holds the two-step verification setup (H04). */
export function SecurityPage({ user }: SecurityPageProps) {
  return (
    <section aria-labelledby="page-title" className="max-w-2xl">
      <h1 id="page-title" className="text-2xl font-bold">
        Account preferences and security
      </h1>
      <p className="mt-1 text-sm text-muted">Signed in as {user.email}</p>
      <TwoStepSection enabled={user.mfaEnabled} />
      <SessionsSection />
    </section>
  );
}

function TwoStepSection({ enabled }: { enabled: boolean }) {
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  // Just turned on: the codes are showing and the session has not reloaded the user yet.
  const isOn = enabled || recoveryCodes !== null;

  return (
    <section
      aria-labelledby="two-step-title"
      className="mt-6 rounded-lg border border-border bg-surface p-6"
    >
      <h2 id="two-step-title" className="font-semibold">
        Two-step verification
      </h2>
      <p className="mt-1 text-sm text-muted">
        {isOn
          ? 'On. Signing in needs your password and a code from your authenticator app.'
          : 'Off. Add a code from an authenticator app to protect your account if your password leaks.'}
      </p>
      <div className="mt-4">
        {recoveryCodes ? (
          <RecoveryCodes codes={recoveryCodes} onDone={() => setRecoveryCodes(null)} />
        ) : enabled ? (
          <TurnOffForm />
        ) : (
          <SetupFlow onEnabled={setRecoveryCodes} />
        )}
      </div>
    </section>
  );
}

function SetupFlow({ onEnabled }: { onEnabled: (codes: string[]) => void }) {
  const auth = useAuth();
  const [setup, setSetup] = useState<MfaSetupResponse | null>(null);
  const start = useFormAction(async () => {
    setSetup(await auth.request<MfaSetupResponse>('/auth/mfa/setup', { method: 'POST' }));
  });
  const confirm = useFormAction(async (form) => {
    const response = await auth.request<MfaEnableResponse>('/auth/mfa/enable', {
      body: { password: field(form, 'password'), code: field(form, 'code') },
    });
    onEnabled(response.recoveryCodes);
  });

  if (!setup) {
    return (
      // The button is replaced by the steps below; SetupSteps takes focus when it appears.

      <form onSubmit={start.onSubmit} className="flex flex-col items-start gap-3">
        {start.error && <FormMessage tone="error">{start.error}</FormMessage>}
        <SubmitButton busy={start.busy}>Set up two-step verification</SubmitButton>
      </form>
    );
  }

  return <SetupSteps setup={setup} confirm={confirm} />;
}

interface SetupStepsProps {
  readonly setup: MfaSetupResponse;
  readonly confirm: ReturnType<typeof useFormAction>;
}

function SetupSteps({ setup, confirm }: SetupStepsProps) {
  const ref = useFocusOnMount<HTMLDivElement>();
  return (
    <div ref={ref} tabIndex={-1} className="flex flex-col gap-4 outline-none">
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Open an authenticator app, such as Google Authenticator or Microsoft Authenticator.</li>
        <li>Scan the QR code, or type the key below.</li>
        <li>Enter your password and the 6-digit code the app shows.</li>
      </ol>
      <QrCode value={setup.otpauthUri} />
      <p className="text-sm">
        Key: <code className="font-mono break-all select-all">{setup.secret}</code>
      </p>
      <form onSubmit={confirm.onSubmit} className="flex flex-col gap-4" noValidate>
        {confirm.error && <FormMessage tone="error">{confirm.error}</FormMessage>}
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <TextField
          label="Code from the app"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
        <SubmitButton busy={confirm.busy}>Turn on</SubmitButton>
      </form>
    </div>
  );
}

function QrCode({ value }: { value: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    QRCode.toDataURL(value, { margin: 1, width: 192 })
      .then((url) => {
        if (current) setDataUrl(url);
      })
      .catch(() => {
        if (current) setDataUrl(null);
      });
    return () => {
      current = false;
    };
  }, [value]);

  if (!dataUrl) return null;
  return (
    <img
      src={dataUrl}
      width={192}
      height={192}
      alt="QR code for your authenticator app. If you cannot scan it, type the key shown below."
      className="rounded-md border border-border bg-white p-2"
    />
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const auth = useAuth();
  const finish = useFormAction(async () => {
    await auth.reloadUser();
    onDone();
  });

  return (
    <div className="flex flex-col gap-4">
      <FormMessage tone="success">
        Two-step verification is on, and your other devices were signed out.
      </FormMessage>
      <p className="text-sm">
        Save these recovery codes somewhere safe. Each one signs you in once if you lose your phone.
        They will not be shown again.
      </p>
      <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-2 font-mono text-sm">
        {codes.map((code) => (
          <li key={code} className="rounded-md bg-surface-muted px-3 py-1.5 text-center">
            {code}
          </li>
        ))}
      </ul>
      <form onSubmit={finish.onSubmit}>
        {finish.error && <FormMessage tone="error">{finish.error}</FormMessage>}
        <SubmitButton busy={finish.busy}>I saved my codes</SubmitButton>
      </form>
    </div>
  );
}

function TurnOffForm() {
  const auth = useAuth();
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    await auth.request('/auth/mfa/disable', {
      body: { password: field(form, 'password'), code: field(form, 'code') },
    });
    await auth.reloadUser();
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <p className="text-sm">To turn it off, confirm with your password and a current code.</p>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <TextField
        label="Code from the app"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
      />
      <SubmitButton busy={busy}>Turn off two-step verification</SubmitButton>
    </form>
  );
}
