import { PASSWORD_MIN_LENGTH, ROLE_LABELS, type CurrentUser } from '@lead/schema';
import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { useAuth } from '../auth/session';
import { field, FormMessage, SubmitButton, TextField, useFormAction } from '../components/form';

/** H07 profile: name and password. */
export function ProfilePage({ user }: { user: CurrentUser }) {
  return (
    <section aria-labelledby="page-title" className="max-w-2xl">
      <h1 id="page-title" className="text-2xl font-bold">
        Profile and account
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {ROLE_LABELS[user.role]} · {user.email}
      </p>
      <NameForm user={user} />
      <PasswordForm />
    </section>
  );
}

function NameForm({ user }: { user: CurrentUser }) {
  const auth = useAuth();
  const [saved, setSaved] = useState(false);
  const { busy, error, onSubmit } = useFormAction(async (form) => {
    setSaved(false);
    await auth.request('/me/profile', {
      method: 'PATCH',
      body: { displayName: field(form, 'displayName') },
    });
    await auth.reloadUser();
    setSaved(true);
  });

  return (
    <Card className="card-interactive mt-6 px-6">
      <form
        onSubmit={onSubmit}
        aria-labelledby="name-title"
        className="flex flex-col gap-4"
        noValidate
      >
        <h2 id="name-title" className="font-semibold">
          Your name
        </h2>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        {saved && <FormMessage tone="success">Name saved.</FormMessage>}
        <TextField
          label="Full name"
          name="displayName"
          autoComplete="name"
          defaultValue={user.displayName}
          required
        />
        <div>
          <SubmitButton busy={busy}>Save name</SubmitButton>
        </div>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const auth = useAuth();
  const [saved, setSaved] = useState(false);
  const { busy, error, setError, onSubmit } = useFormAction(async (form) => {
    setSaved(false);
    const newPassword = field(form, 'newPassword');
    if (newPassword !== field(form, 'confirm')) {
      setError('The two new passwords do not match.');
      return;
    }
    await auth.request('/me/password', {
      body: { currentPassword: field(form, 'currentPassword'), newPassword },
    });
    setSaved(true);
  });

  return (
    <Card className="card-interactive mt-6 px-6">
      <form
        onSubmit={onSubmit}
        aria-labelledby="password-title"
        className="flex flex-col gap-4"
        noValidate
      >
        <h2 id="password-title" className="font-semibold">
          Change password
        </h2>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        {saved && (
          <FormMessage tone="success">
            Password changed. Your other devices were signed out.
          </FormMessage>
        )}
        <TextField
          label="Current password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
        <TextField
          label="New password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
          required
        />
        <TextField
          label="Repeat the new password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
        />
        <div>
          <SubmitButton busy={busy}>Change password</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
