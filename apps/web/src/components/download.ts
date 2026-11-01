import type { AuthStore } from '../auth/auth-store';

/**
 * Fetches a file with the signed-in session (the access token lives in memory, so a plain link
 * cannot carry it) and hands it to the browser as a download.
 */
export async function downloadFile(
  auth: Pick<AuthStore, 'request'>,
  path: string,
  fileName: string,
): Promise<void> {
  const blob = await auth.request<Blob>(path, { expect: 'blob' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // Give the browser a moment to start the download before the address is released.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
