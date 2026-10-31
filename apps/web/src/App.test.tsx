import type { Role } from '@lead/schema';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { PreviewRoleProvider } from './shell/preview-role';

function renderAt(path: string, role: Role | null = null) {
  const history = createMemoryHistory({ initialEntries: [path] });
  render(
    <PreviewRoleProvider initialRole={role}>
      <App history={history} />
    </PreviewRoleProvider>,
  );
  return history;
}

function mainNav() {
  return screen.getAllByRole('navigation', { name: 'Main' })[0]!;
}

describe('App shell', () => {
  it('shows the preview sign-in when no role is chosen', async () => {
    renderAt('/');
    expect(await screen.findByRole('button', { name: 'Continue as Teacher' })).toBeInTheDocument();
  });

  it('sends a signed-out visitor from a protected page back to sign-in', async () => {
    const history = renderAt('/admin/users');
    await screen.findByRole('button', { name: 'Continue as Administrator' });
    expect(history.location.pathname).toBe('/');
  });

  it('enters the chosen role and shows that role sidebar', async () => {
    renderAt('/');
    await userEvent.click(await screen.findByRole('button', { name: 'Continue as Student' }));

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    const nav = mainNav();
    expect(within(nav).getByRole('link', { name: 'AI Learning Assistant' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Audit Logs' })).not.toBeInTheDocument();
  });

  it('marks the current page in the sidebar', async () => {
    renderAt('/teacher/indicators', 'teacher');

    expect(await screen.findByRole('heading', { name: 'Flagged Students' })).toBeInTheDocument();
    expect(within(mainNav()).getByRole('link', { name: 'Flagged Students' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(mainNav()).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(screen.getByText('T19')).toBeInTheDocument();
  });

  it("redirects a role away from another role's pages", async () => {
    const history = renderAt('/admin/audit', 'student');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(history.location.pathname).toBe('/student');
  });

  it('opens shared pages for any role', async () => {
    renderAt('/notifications', 'admin');
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('logs out back to the sign-in screen', async () => {
    renderAt('/admin', 'admin');
    await screen.findByRole('heading', { name: 'Dashboard' });
    await userEvent.click(within(mainNav().parentElement!).getByRole('button', { name: 'Logout' }));

    expect(await screen.findByRole('button', { name: 'Continue as Student' })).toBeInTheDocument();
    expect(window.localStorage.getItem('lead.previewRole')).toBeNull();
  });

  it('opens the mobile menu drawer and closes it after navigating', async () => {
    renderAt('/student', 'student');
    await userEvent.click(await screen.findByRole('button', { name: 'Open menu' }));

    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    await userEvent.click(within(drawer).getByRole('link', { name: 'Progress' }));

    expect(await screen.findByRole('heading', { name: 'Progress' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
  });

  it('moves focus into the drawer, closes on Escape and restores focus', async () => {
    renderAt('/teacher', 'teacher');
    const openButton = await screen.findByRole('button', { name: 'Open menu' });
    await userEvent.click(openButton);

    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    expect(drawer).toContainElement(document.activeElement as HTMLElement);

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
    expect(openButton).toHaveFocus();
  });

  it('lets every role reach its profile from the top bar', async () => {
    renderAt('/admin', 'admin');
    await userEvent.click(await screen.findByRole('link', { name: 'Administrator account' }));
    expect(await screen.findByRole('heading', { name: 'Profile and account' })).toBeInTheDocument();
  });
});
