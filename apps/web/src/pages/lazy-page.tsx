import {
  Component,
  lazy,
  Suspense,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';

interface BoundaryState {
  readonly failed: boolean;
}

/**
 * Catches a page whose code could not be fetched (offline, or the app was updated and the old
 * file names are gone) and offers a reload, instead of a blank screen.
 */
class PageLoadBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-start gap-3 text-sm">
        <p>This page could not load. Check your connection, then reload.</p>
        <Button type="button" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}

/**
 * A page loaded the first time it renders. It has its own Suspense boundary, around nothing but
 * its code loading: a boundary higher up would also catch the router's own pauses and hide (not
 * remount) a page already on screen, which loses keyboard focus. A failed load is tried once
 * more, then shown as an error with a reload button.
 *
 * React's lazy(), not the router's lazyRouteComponent: most pages are rendered by small route
 * wrappers with props, which lazyRouteComponent does not expect (React warns in development).
 */
export function lazyPage<P extends object>(
  load: () => Promise<ComponentType<P>>,
): (props: P) => ReactElement {
  const Page = lazy(async () => ({ default: await load().catch(() => load()) }));
  return function LazyPage(props: P) {
    return (
      <PageLoadBoundary>
        <Suspense fallback={<p role="status">Loading…</p>}>
          <Page {...props} />
        </Suspense>
      </PageLoadBoundary>
    );
  };
}
