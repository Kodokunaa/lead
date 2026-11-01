import type { Term, TermCalendar } from '@lead/schema';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser, installFakeApi, type FakeApi } from '../../../test/fake-api';
import { renderApp } from '../../../test/render-app';

const CURRENT: Term = {
  id: '11111111-1111-4111-8111-111111111111',
  schoolYear: '2026-2027',
  semester: 'first',
  startsOn: '2026-08-10',
  endsOn: '2026-12-18',
  current: true,
};
const NEXT: Term = {
  ...CURRENT,
  id: '22222222-2222-4222-8222-222222222222',
  semester: 'second',
  startsOn: '2027-01-11',
  endsOn: '2027-05-21',
  current: false,
};
const COURSE = { id: '33333333-3333-4333-8333-333333333333', code: 'IS 301' };
const EVENT_ID = '44444444-4444-4444-8444-444444444444';

function calendar(overrides: Partial<TermCalendar> = {}): TermCalendar {
  return {
    term: CURRENT,
    gradingPeriods: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Prelim',
        position: 1,
        startsOn: '2026-08-10',
        endsOn: '2026-09-25',
      },
    ],
    events: [
      {
        id: EVENT_ID,
        title: 'Midterm examinations',
        kind: 'assessment_period',
        startsOn: '2026-10-12',
        endsOn: '2026-10-16',
        courses: [COURSE],
      },
    ],
    offerings: [{ ...COURSE, title: 'Database Systems', sections: 2 }],
    ...overrides,
  };
}

function adminApi(): FakeApi {
  const api = installFakeApi(fakeUser('admin'));
  api.on('GET /admin/terms', { status: 200, body: [NEXT, CURRENT] });
  api.on(`GET /admin/terms/${CURRENT.id}/calendar`, { status: 200, body: calendar() });
  return api;
}

describe('academic calendar (A08)', () => {
  it('shows the current term: dates, grading periods and the calendar in date order', async () => {
    adminApi();
    renderApp('/admin/courses/calendar');

    expect(
      await screen.findByRole('heading', { name: 'Programs, terms and academic calendar' }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('Start date')).toHaveValue('2026-08-10');
    expect(screen.getByText(/1 course offering uses this term/)).toBeInTheDocument();
    const periods = screen.getByRole('list', { name: 'Grading periods' });
    expect(within(periods).getAllByLabelText('Name')[0]).toHaveValue('Prelim');

    const rows = within(screen.getByRole('table', { name: 'Calendar events' }))
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.textContent);
    expect(rows[0]).toContain('Term start');
    expect(rows[1]).toContain('Midterm examinations');
    expect(rows[1]).toContain('IS 301');
    expect(rows[2]).toContain('Term end');
  });

  it('moves to another term from the term list', async () => {
    const api = adminApi();
    api.on(`GET /admin/terms/${NEXT.id}/calendar`, {
      status: 200,
      body: calendar({ term: NEXT, gradingPeriods: [], events: [], offerings: [] }),
    });
    const { history } = renderApp('/admin/courses/calendar');

    await screen.findByLabelText('Start date');
    await userEvent.selectOptions(screen.getByLabelText('Term'), NEXT.id);

    expect(await screen.findByText(/No course offerings use this term/)).toBeInTheDocument();
    expect(history.location.search).toBe(`?term=${NEXT.id}`);
  });

  it("saves the term's dates and shows a refusal from the server", async () => {
    const api = adminApi();
    api.on(`PATCH /admin/terms/${CURRENT.id}`, {
      status: 409,
      body: { message: 'The event "Midterm examinations" would fall outside the term.' },
    });
    renderApp('/admin/courses/calendar');

    const end = await screen.findByLabelText('End date');
    await userEvent.clear(end);
    await userEvent.type(end, '2026-10-01');
    await userEvent.click(screen.getByRole('button', { name: 'Save dates' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('would fall outside the term');
    expect(api.bodyOf(`PATCH /admin/terms/${CURRENT.id}`)).toEqual({
      startsOn: '2026-08-10',
      endsOn: '2026-10-01',
    });
  });

  it('edits the grading periods as one list', async () => {
    const api = adminApi();
    api.on(`PUT /admin/terms/${CURRENT.id}/grading-periods`, { status: 200, body: calendar() });
    renderApp('/admin/courses/calendar');

    await userEvent.click(await screen.findByRole('button', { name: 'Add period' }));
    const periods = screen.getByRole('list', { name: 'Grading periods' });
    const second = within(periods).getAllByRole('group')[1]!;
    await userEvent.type(within(second).getByLabelText('Name'), 'Midterm');
    await userEvent.type(within(second).getByLabelText('Starts'), '2026-09-28');
    await userEvent.type(within(second).getByLabelText('Ends'), '2026-11-13');
    await userEvent.click(screen.getByRole('button', { name: 'Save grading periods' }));

    expect(await screen.findByText('Grading periods saved.')).toBeInTheDocument();
    expect(api.bodyOf(`PUT /admin/terms/${CURRENT.id}/grading-periods`)).toEqual({
      periods: [
        { name: 'Prelim', startsOn: '2026-08-10', endsOn: '2026-09-25' },
        { name: 'Midterm', startsOn: '2026-09-28', endsOn: '2026-11-13' },
      ],
    });
  });

  it('adds an event for the whole term', async () => {
    const api = adminApi();
    api.on(`POST /admin/terms/${CURRENT.id}/events`, { status: 201, body: calendar() });
    renderApp('/admin/courses/calendar');

    await userEvent.click(await screen.findByRole('button', { name: 'Add event' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a calendar event' });
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Grade release');
    await userEvent.selectOptions(within(dialog).getByLabelText('Kind'), 'grade_release');
    await userEvent.type(within(dialog).getByLabelText('Starts'), '2026-12-22');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add event' }));

    expect(await screen.findByText('Event added.')).toBeInTheDocument();
    expect(api.bodyOf(`POST /admin/terms/${CURRENT.id}/events`)).toEqual({
      title: 'Grade release',
      kind: 'grade_release',
      startsOn: '2026-12-22',
      endsOn: '',
      courseIds: [],
    });
  });

  it('removes an event after confirming', async () => {
    const api = adminApi();
    api.on(`POST /admin/terms/${CURRENT.id}/events/${EVENT_ID}/remove`, {
      status: 200,
      body: calendar({ events: [] }),
    });
    renderApp('/admin/courses/calendar');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove Midterm examinations' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Remove Midterm examinations?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove event' }));

    expect(await screen.findByText('Midterm examinations removed.')).toBeInTheDocument();
    expect(api.calls).toContain(`POST /admin/terms/${CURRENT.id}/events/${EVENT_ID}/remove`);
  });

  it('keeps focus in the card when a grading period is removed', async () => {
    adminApi();
    renderApp('/admin/courses/calendar');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Remove grading period Prelim' }),
    );

    expect(screen.queryByLabelText('Name, grading period 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add period' })).toHaveFocus();
  });

  it('keeps the term list focused while moving between terms', async () => {
    const api = adminApi();
    api.on(`GET /admin/terms/${NEXT.id}/calendar`, {
      status: 200,
      body: calendar({ term: NEXT, gradingPeriods: [], events: [], offerings: [] }),
    });
    api.on(`GET /admin/terms/${CURRENT.id}/calendar`, { status: 200, body: calendar() });
    renderApp(`/admin/courses/calendar?term=${NEXT.id}`);

    const select = await screen.findByLabelText('Term');
    await screen.findByText(/No course offerings use this term/);
    select.focus();
    await userEvent.selectOptions(select, CURRENT.id);

    expect(await screen.findByText(/1 course offering uses this term/)).toBeInTheDocument();
    expect(screen.getByLabelText('Term')).toHaveFocus();
  });

  it('is for administrators only', async () => {
    installFakeApi(fakeUser('teacher'));
    renderApp('/admin/courses/calendar');

    expect(
      await screen.findByRole('heading', { name: 'You do not have access to this page' }),
    ).toBeInTheDocument();
  });
});
