import type { UserDetails, UserListResponse, UserSummary } from '@lead/schema';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi } from '../../test/fake-api';
import { renderApp } from '../../test/render-app';

const ADMIN = fakeUser('admin', { id: '11111111-1111-4111-8111-111111111111' });
const LEARNER_ID = '22222222-2222-4222-8222-222222222222';

function summary(overrides: Partial<UserSummary> = {}): UserSummary {
  return {
    id: LEARNER_ID,
    email: 'learner99@lead.test',
    displayName: 'Learner 99',
    role: 'student',
    status: 'pending',
    emailVerified: true,
    mfaEnabled: false,
    createdAt: '2026-11-01T01:00:00.000Z',
    ...overrides,
  };
}

function details(overrides: Partial<UserDetails> = {}): UserDetails {
  return {
    ...summary(),
    lockedUntil: null,
    activeSessions: 0,
    lastSignInAt: null,
    activity: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        occurredAt: '2026-11-01T01:00:00.000Z',
        action: 'auth.email_verified',
        outcome: 'success',
        reason: null,
        actorName: 'Learner 99',
      },
    ],
    ...overrides,
  };
}

function list(
  items: UserSummary[],
  awaitingApproval = 1,
): { status: number; body: UserListResponse } {
  return {
    status: 200,
    body: { items, total: items.length, page: 1, pageSize: 25, awaitingApproval },
  };
}

describe('user management (A02, A16)', () => {
  it('lists accounts and filters to the approval queue', async () => {
    const api = installFakeApi(ADMIN);
    api.on(
      'GET /admin/users?page=1',
      list([summary(), summary({ id: ADMIN.id, status: 'active' })]),
    );
    api.on('GET /admin/users?status=pending&page=1', list([summary()]));
    renderApp('/admin/users');

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Waiting for approval (1)' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Waiting for approval (1)' }));

    expect(await screen.findByText('Email confirmed, ready to approve')).toBeInTheDocument();
    expect(api.calls).toContain('GET /admin/users?status=pending&page=1');
  });

  it('searches by name or email', async () => {
    const api = installFakeApi(ADMIN);
    api.on('GET /admin/users?page=1', list([summary()]));
    api.on('GET /admin/users?q=learner+99&page=1', list([summary()]));
    renderApp('/admin/users');

    await userEvent.type(await screen.findByLabelText('Search by name or email'), 'learner 99');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    await screen.findByRole('table');
    expect(api.calls).toContain('GET /admin/users?q=learner+99&page=1');
  });
});

describe('user details (A03)', () => {
  it('approves a confirmed registration and shows the new state', async () => {
    const api = installFakeApi(ADMIN);
    api.on(`GET /admin/users/${LEARNER_ID}`, { status: 200, body: details() });
    api.on(`POST /admin/users/${LEARNER_ID}/approve`, () => {
      api.on(`GET /admin/users/${LEARNER_ID}`, {
        status: 200,
        body: details({ status: 'active' }),
      });
      return { status: 200, body: summary({ status: 'active' }) };
    });
    renderApp(`/admin/users/${LEARNER_ID}`);

    const approve = await screen.findByRole('form', { name: 'Approve this account' });
    await userEvent.click(within(approve).getByRole('button', { name: 'Approve' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Account approved.');
    expect(await screen.findByRole('form', { name: 'Deactivate account' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Approve this account' })).not.toBeInTheDocument();
  });

  it('sends the reason with a role change, and shows the API error', async () => {
    const api = installFakeApi(ADMIN);
    api.on(`GET /admin/users/${LEARNER_ID}`, {
      status: 200,
      body: details({ status: 'active' }),
    });
    api.on(`POST /admin/users/${LEARNER_ID}/role`, {
      status: 400,
      body: { message: 'Choose a role. Give a reason of at least 3 characters.' },
    });
    renderApp(`/admin/users/${LEARNER_ID}`);

    const form = await screen.findByRole('form', { name: 'Change role' });
    await userEvent.selectOptions(within(form).getByLabelText('New role'), 'teacher');
    await userEvent.type(within(form).getByLabelText(/^Reason/), 'ok');
    await userEvent.click(within(form).getByRole('button', { name: 'Change role' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent('at least 3 characters');
    expect(api.bodyOf(`POST /admin/users/${LEARNER_ID}/role`)).toEqual({
      role: 'teacher',
      reason: 'ok',
    });
  });

  it('asks for the administrator password to reset two-step verification', async () => {
    const api = installFakeApi(ADMIN);
    api.on(`GET /admin/users/${LEARNER_ID}`, {
      status: 200,
      body: details({ status: 'active', mfaEnabled: true }),
    });
    api.on(`POST /admin/users/${LEARNER_ID}/mfa/reset`, {
      status: 200,
      body: summary({ status: 'active' }),
    });
    renderApp(`/admin/users/${LEARNER_ID}`);

    const form = await screen.findByRole('form', { name: 'Reset two-step verification' });
    await userEvent.type(within(form).getByLabelText(/^Reason/), 'Lost phone, ID checked');
    await userEvent.type(within(form).getByLabelText(/^Your password/), 'admin passphrase');
    await userEvent.click(
      within(form).getByRole('button', { name: 'Reset two-step verification' }),
    );

    expect(await screen.findByText('Two-step verification reset.')).toBeInTheDocument();
    expect(api.bodyOf(`POST /admin/users/${LEARNER_ID}/mfa/reset`)).toEqual({
      reason: 'Lost phone, ID checked',
      password: 'admin passphrase',
    });
  });

  it('offers nothing but the record for a rejected registration', async () => {
    const api = installFakeApi(ADMIN);
    api.on(`GET /admin/users/${LEARNER_ID}`, {
      status: 200,
      body: details({ status: 'rejected' }),
    });
    renderApp(`/admin/users/${LEARNER_ID}`);

    expect(await screen.findByText('Rejected')).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it("offers no changes on the administrator's own account", async () => {
    const api = installFakeApi(ADMIN);
    api.on(`GET /admin/users/${ADMIN.id}`, {
      status: 200,
      body: details({ ...summary({ id: ADMIN.id, role: 'admin', status: 'active' }) }),
    });
    renderApp(`/admin/users/${ADMIN.id}`);

    expect(await screen.findByText(/This is your account/)).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('is not open to teachers', async () => {
    installFakeApi(fakeUser('teacher'));
    renderApp(`/admin/users/${LEARNER_ID}`);
    expect(
      await screen.findByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeInTheDocument();
  });
});

describe('roles and permissions (A04)', () => {
  it('shows what each role can do', async () => {
    installFakeApi(ADMIN);
    renderApp('/admin/roles');

    const row = await screen.findByRole('row', { name: /Approve registrations/ });
    expect(within(row).getAllByText('Yes')).toHaveLength(1);
    expect(within(row).getAllByText('No')).toHaveLength(2);
  });
});
