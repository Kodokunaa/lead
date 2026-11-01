import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from 'cn';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '../auth/api';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  readonly label: string;
  readonly hint?: string;
}

export function TextField({ label, hint, className, ...input }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-describedby={hint ? hintId : undefined}
        className={cn(
          'h-11 rounded-xl px-4 focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/20',
          className,
        )}
        {...input}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

interface SubmitButtonProps {
  readonly busy: boolean;
  readonly children: ReactNode;
}

/**
 * Stays focusable while busy (aria-disabled, not disabled), so a keyboard user's focus does
 * not fall back to the page; useFormAction ignores repeat submits.
 */
export function SubmitButton({ busy, children }: SubmitButtonProps) {
  return (
    <Button type="submit" size="lg" aria-disabled={busy} aria-busy={busy}>
      {children}
    </Button>
  );
}

/** Moves keyboard focus to an element when it appears, e.g. the next step of a form. */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}

interface FormMessageProps {
  readonly tone: 'error' | 'success';
  readonly children: ReactNode;
}

/**
 * Announces a message and moves focus to it, so a keyboard or screen-reader user lands on
 * what changed instead of where the replaced form used to be.
 */
export function FormMessage({ tone, children }: FormMessageProps) {
  const ref = useFocusOnMount<HTMLDivElement>();
  const Icon = tone === 'error' ? CircleAlert : CircleCheck;
  return (
    <Alert
      ref={ref}
      tabIndex={-1}
      role={tone === 'error' ? 'alert' : 'status'}
      variant={tone === 'error' ? 'destructive' : 'default'}
      className={cn(
        'animate-rise rounded-xl outline-none',
        tone === 'error' ? 'border-red-200 bg-red-50' : 'border-orange-200 bg-accent',
      )}
    >
      <Icon aria-hidden="true" />
      <AlertDescription className="text-current">{children}</AlertDescription>
    </Alert>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

/**
 * Submit handling shared by every form: one request at a time, and the API's message shown
 * on failure. `action` returns nothing; success is whatever it does next (navigate, set state).
 */
export function useFormAction(action: (form: FormData) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    action(form)
      .catch((caught: unknown) => setError(errorMessage(caught)))
      .finally(() => setBusy(false));
  };

  return { busy, error, setError, onSubmit };
}

export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
