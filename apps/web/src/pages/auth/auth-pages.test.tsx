import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi, sessionFor } from '../../test/fake-api';
import { renderApp } from '../../test/render-app';

async function fillSignIn(email: string, password: string) {
  await userEvent.type(await screen.findByLabelText('Email'), email);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('sign-in (H01) and second factor (H05)', () => {
  it("signs in and lands on the user's dashboard", async () => {
    const api = installFakeApi();
    api.on('POST /auth/sign-in', sessionFor(fakeUser('teacher')));
    const { history } = renderApp('/');

    await fillSignIn('teacher@lead.test', 'a long enough passphrase');

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(history.location.pathname).toBe('/teacher');
    expect(api.bodyOf('POST /auth/sign-in')).toEqual({
      email: 'teacher@lead.test',
      password: 'a long enough passphrase',
    });
  });

  it("shows the API's message when sign-in fails", async () => {
    const api = installFakeApi();
    api.on('POST /auth/sign-in', {
      status: 401,
      body: { code: 'invalid_credentials', message: 'Email or password is incorrect.' },
    });
    renderApp('/');

    await fillSignIn('someone@lead.test', 'wrong');

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  });

  it('asks for a code when the account has MFA, then signs in', async () => {
    const api = installFakeApi();
    api.on('POST /auth/sign-in', {
      status: 200,
      body: { mfaRequired: true, challengeToken: 'challenge-1' },
    });
    api.on('POST /auth/mfa/verify', sessionFor(fakeUser('student', { mfaEnabled: true })));
    renderApp('/');

    await fillSignIn('student@lead.test', 'a long enough passphrase');
    expect(
      await screen.findByRole('heading', { name: 'Two-step verification' }),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Authentication code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(api.bodyOf('POST /auth/mfa/verify')).toEqual({
      challengeToken: 'challenge-1',
      code: '123456',
    });
  });

  it('accepts a recovery code instead', async () => {
    const api = installFakeApi();
    api.on('POST /auth/sign-in', {
      status: 200,
      body: { mfaRequired: true, challengeToken: 'challenge-1' },
    });
    api.on('POST /auth/mfa/verify', sessionFor(fakeUser('student', { mfaEnabled: true })));
    renderApp('/');

    await fillSignIn('student@lead.test', 'a long enough passphrase');
    await userEvent.click(await screen.findByRole('button', { name: 'Use a recovery code' }));
    await userEvent.type(screen.getByLabelText('Recovery code'), 'ABCDE-FGHJK');
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(api.bodyOf('POST /auth/mfa/verify')).toEqual({
      challengeToken: 'challenge-1',
      recoveryCode: 'ABCDE-FGHJK',
    });
  });
});

describe('account requests (H02, H03)', () => {
  it('requests an account and shows the confirmation message', async () => {
    const api = installFakeApi();
    api.on('POST /auth/register', { status: 202, body: { message: 'Check your email.' } });
    renderApp('/register');

    await userEvent.type(await screen.findByLabelText('Full name'), 'Learner 99');
    await userEvent.type(screen.getByLabelText('Email'), 'learner99@lead.test');
    await userEvent.click(screen.getByLabelText('Teacher'));
    await userEvent.click(screen.getByRole('button', { name: 'Request account' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Check your email.');
    expect(api.bodyOf('POST /auth/register')).toEqual({
      email: 'learner99@lead.test',
      displayName: 'Learner 99',
      role: 'teacher',
    });
  });

  it('asks for a reset link', async () => {
    const api = installFakeApi();
    api.on('POST /auth/password/forgot', { status: 202, body: { message: 'Link on its way.' } });
    renderApp('/forgot-password');

    await userEvent.type(await screen.findByLabelText('Email'), 'learner@lead.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Link on its way.');
  });

  it('sets a new password from the emailed link', async () => {
    const api = installFakeApi();
    api.on('POST /auth/password/reset', { status: 204 });
    const { history } = renderApp('/reset-password#token=emailed-reset-token');

    // The token leaves the address bar (and history) as soon as the page has read it.
    await waitFor(() => expect(history.location.hash).toBe(''));

    await userEvent.type(await screen.findByLabelText(/^New password/), 'a brand new passphrase');
    await userEvent.type(screen.getByLabelText('Repeat the password'), 'a different one');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
    expect(api.calls).not.toContain('POST /auth/password/reset');

    await userEvent.clear(screen.getByLabelText('Repeat the password'));
    await userEvent.type(screen.getByLabelText('Repeat the password'), 'a brand new passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Sign in again');
    expect(api.bodyOf('POST /auth/password/reset')).toEqual({
      token: 'emailed-reset-token',
      password: 'a brand new passphrase',
    });
  });

  it('explains when a link has no token', async () => {
    installFakeApi();
    renderApp('/confirm-email');
    expect(await screen.findByRole('alert')).toHaveTextContent('This link is incomplete');
  });
});
