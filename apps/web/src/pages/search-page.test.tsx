import type { SearchResponse } from '@lead/schema';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi } from '../test/fake-api';
import { renderApp } from '../test/render-app';

const SECTION_ID = '11111111-1111-4111-8111-111111111111';
const LESSON_ID = '22222222-2222-4222-8222-222222222222';

const found: SearchResponse = {
  query: 'normal',
  truncated: false,
  results: [
    {
      type: 'lesson',
      id: LESSON_ID,
      title: 'Normal forms',
      context: 'IS 301 · Normalization',
      access: 'Enrolled',
      target: { screen: 'S05', sectionId: SECTION_ID, lessonId: LESSON_ID },
    },
  ],
};

describe('permission-scoped search (H09)', () => {
  it('searches from the top bar and links each result to its screen', async () => {
    const api = installFakeApi(fakeUser('student'));
    api.on('GET /search?q=normal', { status: 200, body: found });
    const { history } = renderApp('/student');

    await userEvent.type(
      await screen.findByLabelText('Search permitted courses, resources or records'),
      ' normal {Enter}',
    );

    expect(await screen.findByText('1 result for “normal”.')).toBeInTheDocument();
    expect(history.location.pathname).toBe('/search');
    expect(history.location.search).toBe('?q=normal');
    const row = screen.getByRole('row', { name: /Normal forms/ });
    expect(row).toHaveTextContent('Lesson');
    expect(row).toHaveTextContent('Enrolled');
    expect(within(row).getByRole('link', { name: 'Open Normal forms' })).toHaveAttribute(
      'href',
      `/student/courses/${SECTION_ID}/lessons/${LESSON_ID}`,
    );
  });

  it('asks for a longer query instead of searching for one letter', async () => {
    const api = installFakeApi(fakeUser('teacher'));
    renderApp('/search?q=a');

    expect(await screen.findByText(/Type at least 2 characters/)).toBeInTheDocument();
    expect(api.calls.some((call) => call.startsWith('GET /search'))).toBe(false);
  });

  it('says when nothing the user may open matches, and searches again from the page', async () => {
    const api = installFakeApi(fakeUser('admin'));
    api.on('GET /search?q=zzz', {
      status: 200,
      body: { query: 'zzz', truncated: false, results: [] },
    });
    api.on('GET /search?q=normal', { status: 200, body: found });
    renderApp('/search?q=zzz');

    expect(await screen.findByText('Nothing you can open matches “zzz”.')).toBeInTheDocument();
    const box = screen.getByLabelText('Search records');
    await userEvent.clear(box);
    await userEvent.type(box, 'normal{Enter}');

    expect(await screen.findByText('1 result for “normal”.')).toBeInTheDocument();
  });

  it('says when results were cut short', async () => {
    const api = installFakeApi(fakeUser('admin'));
    api.on('GET /search?q=is', { status: 200, body: { ...found, query: 'is', truncated: true } });
    renderApp('/search?q=is');

    expect(await screen.findByText(/add words to narrow it down/)).toBeInTheDocument();
  });
});
