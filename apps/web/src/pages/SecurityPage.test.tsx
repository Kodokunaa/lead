import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi } from '../test/fake-api';
import { renderApp } from '../test/render-app';

describe('two-step verification setup (H04)', () => {
  it('sets up MFA, shows the recovery codes once, then shows it as on', async () => {
    const api = installFakeApi(fakeUser('student'));
    api.on('POST /auth/mfa/setup', {
      status: 200,
      body: { otpauthUri: 'otpauth://totp/LEAD:student?secret=JBSWY3DP', secret: 'JBSWY3DP' },
    });
    api.on('POST /auth/mfa/enable', {
      status: 200,
      body: { recoveryCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] },
    });
    renderApp('/security');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Set up two-step verification' }),
    );
    expect(await screen.findByText('JBSWY3DP')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Password'), 'a long enough passphrase');
    await userEvent.type(screen.getByLabelText('Code from the app'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    const codes = await screen.findByRole('list', { name: 'Recovery codes' });
    expect(screen.getByText(/^On\./)).toBeInTheDocument();
    expect(
      within(codes)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['AAAAA-BBBBB', 'CCCCC-DDDDD']);
    expect(api.bodyOf('POST /auth/mfa/enable')).toEqual({
      password: 'a long enough passphrase',
      code: '123456',
    });

    api.on('GET /auth/me', { status: 200, body: fakeUser('student', { mfaEnabled: true }) });
    await userEvent.click(screen.getByRole('button', { name: 'I saved my codes' }));

    expect(await screen.findByText(/^On\./)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Recovery codes' })).not.toBeInTheDocument();
  });

  it('shows the error when the code is wrong', async () => {
    const api = installFakeApi(fakeUser('teacher'));
    api.on('POST /auth/mfa/setup', {
      status: 200,
      body: { otpauthUri: 'otpauth://totp/x?secret=JBSWY3DP', secret: 'JBSWY3DP' },
    });
    api.on('POST /auth/mfa/enable', {
      status: 401,
      body: { code: 'invalid_code', message: 'That code did not work.' },
    });
    renderApp('/security');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Set up two-step verification' }),
    );
    await userEvent.type(await screen.findByLabelText('Password'), 'a long enough passphrase');
    await userEvent.type(screen.getByLabelText('Code from the app'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work.');
  });
});
