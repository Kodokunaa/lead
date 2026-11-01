import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi, type FakeResponse } from '../test/fake-api';
import { testStore } from '../test/render-app';
import { AuthProvider } from './session';
import { useApiData } from './use-api';

function Probe() {
  const [path, setPath] = useState('/items/1');
  const result = useApiData<{ name: string }>(path);
  return (
    <div>
      <button type="button" onClick={() => setPath('/items/2')}>
        Second
      </button>
      <button type="button" onClick={result.reload}>
        Reload
      </button>
      <p>
        {result.status === 'ready'
          ? `${result.data.name}${result.refreshing ? ' (refreshing)' : ''}`
          : result.status}
      </p>
    </div>
  );
}

async function renderProbe() {
  const store = testStore();
  await store.start();
  render(
    <AuthProvider store={store}>
      <Probe />
    </AuthProvider>,
  );
}

describe('useApiData', () => {
  it('keeps the shown data while a reload runs', async () => {
    const api = installFakeApi(fakeUser('admin'));
    let answer: (response: FakeResponse) => void = () => undefined;
    api.on('GET /items/1', { status: 200, body: { name: 'first' } });
    await renderProbe();
    expect(await screen.findByText('first')).toBeInTheDocument();

    api.on(
      'GET /items/1',
      () =>
        new Promise<FakeResponse>((resolve) => {
          answer = resolve;
        }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(await screen.findByText('first (refreshing)')).toBeInTheDocument();

    answer({ status: 200, body: { name: 'first again' } });
    expect(await screen.findByText('first again')).toBeInTheDocument();
  });

  it('ignores an answer for a request that a newer one replaced', async () => {
    const api = installFakeApi(fakeUser('admin'));
    let answerFirst: (response: FakeResponse) => void = () => undefined;
    api.on(
      'GET /items/1',
      () =>
        new Promise<FakeResponse>((resolve) => {
          answerFirst = resolve;
        }),
    );
    api.on('GET /items/2', { status: 200, body: { name: 'second' } });
    await renderProbe();

    await userEvent.click(screen.getByRole('button', { name: 'Second' }));
    expect(await screen.findByText('second')).toBeInTheDocument();

    answerFirst({ status: 200, body: { name: 'stale first' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText('second')).toBeInTheDocument();
    expect(screen.queryByText('stale first')).not.toBeInTheDocument();
  });
});
