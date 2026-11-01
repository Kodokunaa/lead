import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi, sessionFor } from './test/fake-api';
import { mainNav, renderApp, testStore } from './test/render-app';

describe('App shell', () => {
  it('shows sign-in when there is no session', async () => {
    installFakeApi();
    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('sends a signed-out visitor from a protected page back to sign-in', async () => {
    installFakeApi();
    const { history } = renderApp('/admin/users');
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(history.location.pathname).toBe('/');
  });

  it("restores a session from the refresh cookie and shows that role's sidebar", async () => {
    installFakeApi(fakeUser('student'));
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    const nav = mainNav();
    expect(within(nav).getByRole('link', { name: 'AI Learning Assistant' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Audit Logs' })).not.toBeInTheDocument();
  });

  it('marks the current page in the sidebar', async () => {
    installFakeApi(fakeUser('teacher'));
    renderApp('/teacher/indicators');

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
    installFakeApi(fakeUser('student'));
    const { history } = renderApp('/admin/audit');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(history.location.pathname).toBe('/student');
  });

  it('opens shared pages for any role', async () => {
    installFakeApi(fakeUser('admin'));
    renderApp('/notifications');
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('signs out through the API and returns to sign-in', async () => {
    const api = installFakeApi(fakeUser('admin'));
    renderApp('/admin');
    await screen.findByRole('heading', { name: 'Dashboard' });

    const sidebar = mainNav().parentElement;
    if (!sidebar) throw new Error('Sidebar missing');
    await userEvent.click(within(sidebar).getByRole('button', { name: 'Logout' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(api.calls).toContain('POST /auth/sign-out');
  });

  it('opens the mobile menu drawer and closes it after navigating', async () => {
    installFakeApi(fakeUser('student'));
    renderApp('/student');
    await userEvent.click(await screen.findByRole('button', { name: 'Open menu' }));

    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    await userEvent.click(within(drawer).getByRole('link', { name: 'Progress' }));

    expect(await screen.findByRole('heading', { name: 'Progress' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
  });

  it('moves focus into the drawer, closes on Escape and restores focus', async () => {
    installFakeApi(fakeUser('teacher'));
    renderApp('/teacher');
    const openButton = await screen.findByRole('button', { name: 'Open menu' });
    await userEvent.click(openButton);

    const drawer = screen.getByRole('dialog', { name: 'Menu' });
    expect(drawer).toContainElement(document.activeElement as HTMLElement);

    await userEvent.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument(),
    );
    expect(openButton).toHaveFocus();
  });

  it('lets every role reach its profile from the top bar', async () => {
    installFakeApi(fakeUser('admin'));
    renderApp('/admin');
    await userEvent.click(await screen.findByRole('link', { name: 'Administrator account' }));
    expect(await screen.findByRole('heading', { name: 'Profile and account' })).toBeInTheDocument();
  });
});

describe('session edge cases', () => {
  it('returns to the deep link after signing in', async () => {
    const api = installFakeApi();
    api.on('POST /auth/sign-in', sessionFor(fakeUser('teacher')));
    const { history } = renderApp('/teacher/indicators');

    await userEvent.type(await screen.findByLabelText('Email'), 'teacher@lead.test');
    await userEvent.type(screen.getByLabelText('Password'), 'a long enough passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Flagged Students' })).toBeInTheDocument();
    expect(history.location.pathname).toBe('/teacher/indicators');
  });

  it('ignores a redirect to another site', async () => {
    installFakeApi(fakeUser('student'));
    const { history } = renderApp('/?redirect=//evil.example/steal');

    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(history.location.pathname).toBe('/student');
  });

  it('follows a sign-out made in another tab', async () => {
    installFakeApi(fakeUser('admin'));
    renderApp('/admin');
    await screen.findByRole('heading', { name: 'Dashboard' });

    const otherTab = testStore();
    await otherTab.start();
    await otherTab.signOut();

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('stays signed in and says so when sign-out fails', async () => {
    const api = installFakeApi(fakeUser('admin'));
    api.on('POST /auth/sign-out', { status: 500, body: { message: 'Server error' } });
    renderApp('/admin');
    await screen.findByRole('heading', { name: 'Dashboard' });

    const sidebar = mainNav().parentElement;
    if (!sidebar) throw new Error('Sidebar missing');
    await userEvent.click(within(sidebar).getByRole('button', { name: 'Logout' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign out');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('offers a retry when the server cannot be reached at start-up', async () => {
    const api = installFakeApi();
    api.on('POST /auth/refresh', { status: 503, body: { message: 'Unavailable' } });
    renderApp('/student/progress');

    expect(await screen.findByRole('alert')).toHaveTextContent('could not reach its server');

    api.on('POST /auth/refresh', sessionFor(fakeUser('student')));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Progress' })).toBeInTheDocument();
  });
});
