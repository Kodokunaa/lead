import { NAVIGATION, type Role } from '@lead/schema';
import { Link } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { Logo } from '../components/Logo';
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
        <Logo size={44} className="shrink-0 transition-transform duration-500 hover:rotate-12" />
        <div className="leading-tight">
          <p className="font-bold">Project LEAD</p>
          <p className="text-xs text-muted-foreground">City College of Calapan</p>
        </div>
      </div>

      <nav aria-label="Main" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <ul className="stagger flex flex-col gap-1">
          {NAVIGATION[role].map((item) => {
            const Icon = NAV_ICONS[item.icon];
            return (
              <li key={item.path}>
                <Link
                  to={item.path}
                  onClick={onNavigate}
                  activeOptions={{ exact: item.path === `/${role}` }}
                  className="group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-text transition-all duration-200 hover:translate-x-1 hover:bg-brand-soft aria-[current=page]:bg-brand-soft aria-[current=page]:font-semibold aria-[current=page]:text-brand-strong"
                >
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 left-0 h-0 w-1 -translate-y-1/2 rounded-full bg-brand transition-all duration-300 group-aria-[current=page]:h-6"
                  />
                  <Icon
                    aria-hidden="true"
                    className="size-4 shrink-0 transition-transform duration-200 group-hover:scale-110"
                  />
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
        className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors duration-200 hover:bg-brand-soft hover:text-brand-strong"
      >
        <LogOut aria-hidden="true" className="size-4" />
        Logout
      </button>
    </div>
  );
}
