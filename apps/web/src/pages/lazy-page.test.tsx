import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { lazyPage } from './lazy-page';

function Greeting({ name }: { name: string }) {
  return <h1>Hello {name}</h1>;
}

describe('lazyPage', () => {
  it('shows a loading status, then the page with its props', async () => {
    const Page = lazyPage(() => Promise.resolve(Greeting));
    render(<Page name="Lea" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(await screen.findByRole('heading', { name: 'Hello Lea' })).toBeInTheDocument();
  });

  it('tries a failed load once more', async () => {
    const load = vi
      .fn<() => Promise<typeof Greeting>>()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce(Greeting);
    const Page = lazyPage(load);
    render(<Page name="Lea" />);

    expect(await screen.findByRole('heading', { name: 'Hello Lea' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('offers a reload when the page cannot load', async () => {
    // React reports the caught error to the console; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Page = lazyPage<{ name: string }>(() =>
      Promise.reject(new Error('Failed to fetch dynamically imported module')),
    );
    render(<Page name="Lea" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('This page could not load.');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
