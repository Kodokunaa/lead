import { NAVIGATION, type Role } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { NAV_ICONS } from './nav-icons';

interface SidebarProps {
  readonly role: Role;
  readonly onNavigate?: () => void;
  readonly onLogout: () => void;
}

export function Sidebar({ role, onNavigate, onLogout }: SidebarProps) {
  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div className="flex items-center gap-3 px-2 py-1">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-surface text-xs font-bold"
        >
          CCC
        </span>
        <div className="leading-tight">
          <p className="font-semibold">Project LEAD</p>
          <p className="text-xs text-muted">City College of Calapan</p>
        </div>
      </div>

      <nav aria-label="Main" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <ul className="flex flex-col gap-1">
          {NAVIGATION[role].map((item) => {
            const Icon = NAV_ICONS[item.icon];
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  onClick={onNavigate}
                  activeOptions={{ exact: item.path === `/${role}` }}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-text hover:bg-surface-muted aria-[current=page]:bg-surface-muted aria-[current=page]:font-semibold"
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <button
        type="button"
        onClick={onLogout}
        className="flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-surface-muted"
      >
        <LogOut aria-hidden="true" className="size-4" />
        Logout
      </button>
    </div>
  );
}
