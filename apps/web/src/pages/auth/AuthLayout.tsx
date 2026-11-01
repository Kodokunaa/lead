import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '../../components/Logo';

interface AuthLayoutProps {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}

/**
 * Shared frame for the signed-out screens (H01–H05): the college intro beside a large card
 * with the seal on top. On phones the card comes first, so the form is on screen at once. Both rise in on arrival; a soft orange glow drifts behind the card.
 */
export function AuthLayout({ title, description, children }: AuthLayoutProps) {
  return (
    <main className="relative grid min-h-full place-items-center overflow-hidden px-4 py-10">
      <div
        aria-hidden="true"
        className="auth-glow pointer-events-none absolute top-1/2 right-[-10%] size-[36rem] -translate-y-1/2 rounded-full"
      />
      <div className="relative grid w-full max-w-5xl gap-10 md:grid-cols-2 md:items-center">
        <div className="animate-rise order-2 text-center md:order-1 md:text-left">
          <p className="text-sm font-semibold tracking-widest text-brand-strong uppercase">
            City College of Calapan
          </p>
          <p className="mt-4 text-2xl leading-tight font-bold md:text-4xl">
            Learning Enhancement through{' '}
            <span className="text-brand-strong">Artificial Intelligence</span> and Digital Analytics
          </p>
          <p className="mt-4 text-muted-foreground">
            Secure access to your courses, learning support and academic records.
          </p>
        </div>

        <Card
          className="animate-rise order-1 mx-auto w-full max-w-md md:order-2 gap-6 rounded-[22px] border-0 px-1 py-8 shadow-[var(--lead-shadow-overlay)] sm:px-4"
          style={{ animationDelay: '120ms' }}
        >
          <section aria-labelledby="auth-title">
            <CardHeader className="items-center text-center">
              <div className="flex justify-center">
                <Logo size={88} className="animate-pop" />
              </div>
              <CardTitle>
                <h1 id="auth-title" className="mt-2 text-2xl font-bold">
                  {title}
                </h1>
              </CardTitle>
              {description && <CardDescription>{description}</CardDescription>}
            </CardHeader>
            <CardContent className="mt-6">{children}</CardContent>
          </section>
        </Card>
      </div>
    </main>
  );
}
