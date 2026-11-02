import type { Course, Program } from '@lead/schema';
import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SELECT_CLASS, TextField } from '../../../components/form';

interface CourseFieldsProps {
  /** The course being edited, or none for a new one. */
  readonly course?: Course;
  readonly programs: readonly Program[];
}

/**
 * The course form's fields (code, units, title, program, description), shared by the add/edit
 * dialog on A05 and the record page A06. Programs no longer offered are hidden, except the
 * course's own.
 */
export function CourseFields({ course, programs }: CourseFieldsProps) {
  const programId = useId();
  const descriptionId = useId();
  const offered = programs.filter((program) => program.active || program.id === course?.programId);

  return (
    <>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <TextField label="Course code" name="code" defaultValue={course?.code} required />
        <TextField
          label="Units"
          name="units"
          type="number"
          min={1}
          max={6}
          defaultValue={course?.units ?? 3}
          required
        />
      </div>
      <TextField label="Title" name="title" defaultValue={course?.title} required />
      <div className="flex flex-col gap-2">
        <Label htmlFor={programId}>Program</Label>
        <select
          id={programId}
          name="programId"
          defaultValue={course?.programId ?? ''}
          className={SELECT_CLASS}
        >
          <option value="">General education (all programs)</option>
          {offered.map((program) => (
            <option key={program.id} value={program.id}>
              {program.code} – {program.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={descriptionId}>Description</Label>
        <Textarea
          id={descriptionId}
          name="description"
          defaultValue={course?.description}
          rows={3}
          className="rounded-xl"
        />
      </div>
    </>
  );
}
