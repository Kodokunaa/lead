import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

interface MobileDrawerProps {
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/**
 * Modal navigation drawer for small screens (wireframe X06). Moves focus into the drawer,
 * closes on Escape, and returns focus to whatever opened it. The rest of the page is made
 * inert by the caller while this is open.
 */
export function MobileDrawer({ onClose, children }: MobileDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLElement>('a[href], button')?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <div
        aria-hidden="true"
        className="animate-fade absolute inset-0 bg-stone-900/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="animate-slide-in absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-surface shadow-2xl"
      >
        <button
          type="button"
          aria-label="Close menu"
          className="absolute top-3 right-3 z-10 rounded-xl p-2 transition-colors hover:bg-brand-soft"
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-5" />
        </button>
        {children}
      </div>
    </div>
  );
}
