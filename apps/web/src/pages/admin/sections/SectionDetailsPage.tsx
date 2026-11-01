import {
  MAX_BULK_ENROLL,
  type EnrollResult,
  type EnrollSkipReason,
  type RosterEntry,
  type SectionDetails,
} from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '../../../auth/session';
import { useApiData } from '../../../auth/use-api';
import { errorMessage, field, FormMessage, TextField } from '../../../components/form';
import { FormDialog } from '../../../components/FormDialog';
import { countOf, termName } from '../../../components/format';
import { RosterTable, SeatsBar } from '../../sections/shared';

const SKIP_REASONS: Readonly<Record<EnrollSkipReason, string>> = {
  not_found: 'no account uses this email',
  not_a_student: 'not a student account',
  not_active: 'account not active yet',
  already_enrolled: 'already enrolled',
  section_full: 'section is full',
};

type Notice = { text: string; tone: 'success' | 'error'; key: number };

/** One section: details, teachers and the class list (A07, section view). */
export function SectionDetailsPage({ sectionId }: { sectionId: string }) {
  const auth = useAuth();
  const result = useApiData<SectionDetails>(`/admin/sections/${sectionId}`);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  if (result.status === 'loading') return <p role="status">Loading section…</p>;
  if (result.status === 'error') return <FormMessage tone="error">{result.message}</FormMessage>;
  const section = result.data;

  const announce = (text: string, tone: Notice['tone'] = 'success') => {
    setNotice((previous) => ({ text, tone, key: (previous?.key ?? 0) + 1 }));
    if (tone === 'success') result.reload();
  };

  const removeTeacher = (teacherId: string, name: string) => {
    if (removing) return;
    setRemoving(teacherId);
    auth
      .request(`/admin/sections/${sectionId}/teachers/${teacherId}/remove`, { method: 'POST' })
      .then(
        () => announce(`${name} no longer teaches this section.`),
        (caught: unknown) => announce(errorMessage(caught), 'error'),
      )
      .finally(() => setRemoving(null));
  };

  return (
    <section aria-labelledby="page-title" className="max-w-4xl">
      <p className="text-sm">
        <Link to="/admin/sections" className="link">
          Section Management
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="page-title" className="text-2xl font-bold">
            {section.course.code} · {section.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {section.course.title} · {termName(section.term)} ·{' '}
            {countOf(section.course.units, 'unit')}
          </p>
        </div>
        <EditSectionDialog section={section} onSaved={() => announce('Section updated.')} />
      </div>

      {notice && (
        <div className="mt-4">
          <FormMessage key={notice.key} tone={notice.tone}>
            {notice.text}
          </FormMessage>
        </div>
      )}

      <div className="stagger mt-6 grid gap-4 md:grid-cols-[1fr_2fr]">
        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Seats</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SeatsBar enrolled={section.enrolled} capacity={section.capacity} />
          </CardContent>
        </Card>

        <Card className="card-interactive">
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold">Teachers</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {section.teachers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No teacher assigned yet.</p>
            ) : (
              <ul aria-label="Teachers" className="divide-y divide-border">
                {section.teachers.map((teacher) => (
                  <li key={teacher.id} className="flex items-center justify-between gap-2 py-2">
                    <div>
                      <div className="text-sm font-medium">{teacher.displayName}</div>
                      <div className="text-xs text-muted-foreground">{teacher.email}</div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={removing !== null}
                      onClick={() => removeTeacher(teacher.id, teacher.displayName)}
                      aria-label={`Remove ${teacher.displayName}`}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <FormDialog
                trigger="Assign teacher"
                triggerVariant="outline"
                title="Assign a teacher"
                description="The teacher's account must be active."
                submitLabel="Assign"
                onSubmit={async (form) => {
                  await auth.request(`/admin/sections/${sectionId}/teachers`, {
                    body: { email: field(form, 'email') },
                  });
                }}
                afterSave={() => announce('Teacher assigned.')}
              >
                <TextField label="Teacher's email" name="email" type="email" required />
              </FormDialog>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Students</h2>
        <EnrollDialog
          sectionId={sectionId}
          onDone={(enrollResult) => {
            const lines = [
              enrollResult.added.length > 0
                ? `Enrolled ${countOf(enrollResult.added.length, 'student')}.`
                : '',
              ...enrollResult.skipped.map((skip) => `${skip.email}: ${SKIP_REASONS[skip.reason]}.`),
            ].filter(Boolean);
            announce(lines.join(' '), enrollResult.added.length > 0 ? 'success' : 'error');
          }}
        />
      </div>
      <div className="mt-3">
        <RosterTable
          roster={section.roster}
          actions={(entry) =>
            entry.status === 'enrolled' ? (
              <DropDialog sectionId={sectionId} entry={entry} onDone={announce} />
            ) : null
          }
        />
      </div>
    </section>
  );
}

function EditSectionDialog({ section, onSaved }: { section: SectionDetails; onSaved: () => void }) {
  const auth = useAuth();
  return (
    <FormDialog
      trigger="Edit section"
      triggerVariant="outline"
      title={`Edit ${section.name}`}
      description={`Capacity cannot go below the ${countOf(section.enrolled, 'student')} enrolled.`}
      submitLabel="Save changes"
      onSubmit={async (form) => {
        await auth.request(`/admin/sections/${section.id}`, {
          method: 'PATCH',
          body: { name: field(form, 'name'), capacity: field(form, 'capacity') },
        });
      }}
      afterSave={onSaved}
    >
      <TextField label="Section name" name="name" defaultValue={section.name} required />
      <TextField
        label="Capacity"
        name="capacity"
        type="number"
        min={Math.max(1, section.enrolled)}
        max={200}
        defaultValue={section.capacity}
        required
      />
    </FormDialog>
  );
}

function EnrollDialog({
  sectionId,
  onDone,
}: {
  sectionId: string;
  onDone: (result: EnrollResult) => void;
}) {
  const auth = useAuth();
  const emailsId = useId();
  // A ref, not state: afterSave runs as the dialog closes and must see this request's answer.
  const last = useRef<EnrollResult | null>(null);
  return (
    <FormDialog
      trigger="Enroll students"
      title="Enroll students"
      description={`Paste up to ${MAX_BULK_ENROLL} student emails, separated by commas or new lines.`}
      submitLabel="Enroll"
      onSubmit={async (form) => {
        last.current = await auth.request<EnrollResult>(
          `/admin/sections/${sectionId}/enrollments`,
          {
            body: { emails: field(form, 'emails') },
          },
        );
      }}
      afterSave={() => {
        if (last.current) onDone(last.current);
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={emailsId}>Student emails</Label>
        <Textarea id={emailsId} name="emails" rows={6} required className="rounded-xl" />
      </div>
    </FormDialog>
  );
}

function DropDialog({
  sectionId,
  entry,
  onDone,
}: {
  sectionId: string;
  entry: RosterEntry;
  onDone: (text: string) => void;
}) {
  const auth = useAuth();
  return (
    <FormDialog
      trigger="Drop"
      triggerVariant="ghost"
      triggerLabel={`Drop ${entry.displayName}`}
      title={`Drop ${entry.displayName}`}
      description="They leave the class list; their record stays for the history."
      submitLabel="Drop student"
      onSubmit={async (form) => {
        await auth.request(`/admin/sections/${sectionId}/enrollments/${entry.id}/drop`, {
          body: { reason: field(form, 'reason') },
        });
      }}
      afterSave={() => onDone(`${entry.displayName} was dropped.`)}
    >
      <TextField
        label="Reason"
        name="reason"
        hint="Recorded in the audit log."
        required
        minLength={3}
      />
    </FormDialog>
  );
}
