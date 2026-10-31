import { homePathFor, ROLE_LABELS, ROLES, type Role } from '@lead/schema';
import { useNavigate } from '@tanstack/react-router';
import { PREVIEW_ENABLED, usePreviewRole } from '../shell/preview-role';

/**
 * Phase 0 stand-in for H01 (sign in). Lets the team preview each role's shell.
 * Phase 1 replaces it with real sign-in, MFA and server-side sessions.
 */
export function PreviewSignInPage() {
  const { setRole } = usePreviewRole();
  const navigate = useNavigate();

  const enter = (role: Role) => {
    setRole(role);
    void navigate({ to: homePathFor(role) });
  };

  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="grid w-full max-w-4xl gap-10 md:grid-cols-2 md:items-center">
        <div>
          <p className="text-sm font-bold tracking-wide">CCC / PROJECT LEAD</p>
          <h1 className="mt-4 text-3xl leading-tight">
            Learning Enhancement through Artificial Intelligence and Digital Analytics
          </h1>
          <p className="mt-6 text-muted">
            City College of Calapan. Secure access to authorized courses, learning support and
            academic records.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6">
          <h2 className="font-semibold">{PREVIEW_ENABLED ? 'Preview a role' : 'Sign in'}</h2>
          <p className="mt-1 text-sm text-muted">
            {PREVIEW_ENABLED
              ? 'Development preview. Real sign-in with MFA arrives in Phase 1.'
              : 'Sign-in is not available in this build yet.'}
          </p>
          <div className="mt-6 flex flex-col gap-3">
            {(PREVIEW_ENABLED ? ROLES : []).map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => enter(role)}
                className="rounded-md bg-brand px-4 py-2.5 text-left text-sm font-medium text-brand-text hover:opacity-90"
              >
                Continue as {ROLE_LABELS[role]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
