import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi } from '../test/fake-api';
import { renderApp } from '../test/render-app';

const THIS_DEVICE = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const OTHER_DEVICE = '44444444-4444-4444-8444-444444444444';

describe('profile (H07)', () => {
  it('saves the name and shows it', async () => {
    const api = installFakeApi(fakeUser('student'));
    api.on('PATCH /me/profile', () => {
      api.on('GET /auth/me', {
        status: 200,
        body: fakeUser('student', { displayName: 'Learner Renamed' }),
      });
      return { status: 200, body: fakeUser('student', { displayName: 'Learner Renamed' }) };
    });
    renderApp('/profile');

    const name = await screen.findByLabelText('Full name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Learner Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));

    expect(await screen.findByText('Name saved.')).toBeInTheDocument();
    expect(api.bodyOf('PATCH /me/profile')).toEqual({ displayName: 'Learner Renamed' });
    expect(screen.getByLabelText('Full name')).toHaveValue('Learner Renamed');
  });

  it('changes the password only when both new entries match', async () => {
    const api = installFakeApi(fakeUser('teacher'));
    api.on('POST /me/password', { status: 204 });
    renderApp('/profile');

    const form = await screen.findByRole('form', { name: 'Change password' });
    await userEvent.type(within(form).getByLabelText('Current password'), 'old passphrase here');
    await userEvent.type(within(form).getByLabelText(/^New password/), 'a brand new passphrase');
    await userEvent.type(within(form).getByLabelText('Repeat the new password'), 'different');
    await userEvent.click(within(form).getByRole('button', { name: 'Change password' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('do not match');
    expect(api.calls).not.toContain('POST /me/password');

    await userEvent.clear(within(form).getByLabelText('Repeat the new password'));
    await userEvent.type(
      within(form).getByLabelText('Repeat the new password'),
      'a brand new passphrase',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Change password' }));

    expect(await within(form).findByRole('status')).toHaveTextContent(
      'other devices were signed out',
    );
    expect(api.bodyOf('POST /me/password')).toEqual({
      currentPassword: 'old passphrase here',
      newPassword: 'a brand new passphrase',
    });
  });
});

describe('signed-in devices (H08)', () => {
  function withTwoDevices() {
    const api = installFakeApi(fakeUser('student'));
    api.on('GET /me/sessions', {
      status: 200,
      body: [
        {
          id: THIS_DEVICE,
          startedAt: '2026-11-01T00:00:00.000Z',
          lastActiveAt: '2026-11-01T02:00:00.000Z',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/150.0',
          ipAddress: '127.0.0.1',
          current: true,
        },
        {
          id: OTHER_DEVICE,
          startedAt: '2026-10-30T00:00:00.000Z',
          lastActiveAt: '2026-10-31T00:00:00.000Z',
          userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/150.0 Mobile Safari/537',
          ipAddress: '10.0.0.8',
          current: false,
        },
      ],
    });
    api.on(`POST /me/sessions/${OTHER_DEVICE}/revoke`, { status: 204 });
    api.on(`POST /me/sessions/${THIS_DEVICE}/revoke`, { status: 204 });
    return api;
  }

  it('lists devices by name and signs one out', async () => {
    const api = withTwoDevices();
    renderApp('/security');

    const devices = await screen.findByRole('list', { name: 'Signed-in devices' });
    expect(within(devices).getByText('Chrome on Windows')).toBeInTheDocument();
    await userEvent.click(
      within(devices).getByRole('button', { name: 'Sign out Chrome on Android' }),
    );

    await screen.findByRole('list', { name: 'Signed-in devices' });
    expect(api.calls).toContain(`POST /me/sessions/${OTHER_DEVICE}/revoke`);
  });

  it('signs this browser out when its own session is ended', async () => {
    withTwoDevices();
    renderApp('/security');

    const devices = await screen.findByRole('list', { name: 'Signed-in devices' });
    await userEvent.click(
      within(devices).getByRole('button', { name: 'Sign out Chrome on Windows (this device)' }),
    );

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
