import { roleSchema, type Role } from '@lead/schema';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Phase 0 only: the role is chosen on the preview sign-in screen and kept in this browser.
 * Phase 1 replaces this with the signed-in session; the API, not this value, enforces access.
 */
const STORAGE_KEY = 'lead.previewRole';

/** The preview role picker never works in a production build. */
export const PREVIEW_ENABLED: boolean = import.meta.env.DEV;

interface PreviewRoleValue {
  readonly role: Role | null;
  readonly setRole: (role: Role | null) => void;
}

const PreviewRoleContext = createContext<PreviewRoleValue | null>(null);

function readStoredRole(): Role | null {
  if (!PREVIEW_ENABLED) return null;
  try {
    const parsed = roleSchema.safeParse(window.localStorage.getItem(STORAGE_KEY));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function storeRole(role: Role | null): void {
  try {
    if (role) window.localStorage.setItem(STORAGE_KEY, role);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked (private mode); the role still lives in memory.
  }
}

interface PreviewRoleProviderProps {
  readonly children: ReactNode;
  readonly initialRole?: Role | null;
}

export function PreviewRoleProvider({ children, initialRole }: PreviewRoleProviderProps) {
  const [role, setRoleState] = useState<Role | null>(() =>
    initialRole === undefined ? readStoredRole() : initialRole,
  );

  const setRole = useCallback((next: Role | null) => {
    if (next !== null && !PREVIEW_ENABLED) return;
    storeRole(next);
    setRoleState(next);
  }, []);

  const value = useMemo(() => ({ role, setRole }), [role, setRole]);
  return <PreviewRoleContext.Provider value={value}>{children}</PreviewRoleContext.Provider>;
}

export function usePreviewRole(): PreviewRoleValue {
  const value = useContext(PreviewRoleContext);
  if (!value) throw new Error('usePreviewRole must be used inside PreviewRoleProvider');
  return value;
}
