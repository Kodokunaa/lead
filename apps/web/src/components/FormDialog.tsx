import { useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormMessage, SubmitButton, useFormAction } from './form';

interface FormDialogProps {
  /** Text of the button that opens the dialog. */
  readonly trigger: ReactNode;
  readonly triggerVariant?: 'default' | 'outline' | 'ghost';
  /** Accessible name for the trigger when its text alone is ambiguous (e.g. "Edit IS 301"). */
  readonly triggerLabel?: string;
  /** Keeps the trigger inactive, e.g. until the data the form needs has loaded. */
  readonly disabled?: boolean;
  readonly title: string;
  readonly description?: string;
  readonly submitLabel: string;
  /** Saves the form; the dialog closes when it resolves and stays open with the error if not. */
  readonly onSubmit: (form: FormData) => Promise<void>;
  /**
   * Runs once the dialog has closed after a successful save, instead of returning focus to the
   * trigger. For actions that remove the trigger's row: the caller moves focus to its message.
   */
  readonly afterSave?: () => void;
  readonly children?: ReactNode;
}

/** A shadcn dialog wrapping one form: open, fill in, save, close. */
export function FormDialog({
  trigger,
  triggerVariant = 'default',
  triggerLabel,
  disabled = false,
  title,
  description,
  submitLabel,
  onSubmit,
  afterSave,
  children,
}: FormDialogProps) {
  const [open, setOpen] = useState(false);
  const saved = useRef(false);
  const {
    busy,
    error,
    setError,
    onSubmit: submit,
  } = useFormAction(async (form) => {
    await onSubmit(form);
    saved.current = true;
    setOpen(false);
  });

  // Cleared on open as well as close: a request that failed after the dialog closed must not
  // greet the next opening with its old error.
  const change = (next: boolean) => {
    setOpen(next);
    setError(null);
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={triggerVariant}
          size={triggerVariant === 'default' ? 'default' : 'sm'}
          aria-label={triggerLabel}
          disabled={disabled}
        >
          {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="rounded-[22px] sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          if (saved.current && afterSave) {
            event.preventDefault();
            afterSave();
          }
          saved.current = false;
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {/* Native checks (required, min/max) run before anything is sent. */}
        <form onSubmit={submit} className="flex flex-col gap-4">
          {error && <FormMessage tone="error">{error}</FormMessage>}
          {children}
          <div className="flex justify-end">
            <SubmitButton busy={busy}>{submitLabel}</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
