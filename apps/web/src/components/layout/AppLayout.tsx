import { PERMISSIONS, ROLE_LABELS } from '@support-desk/shared';
import {
  ChevronDown,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  type LucideIcon,
  Menu,
  Plus,
  Search,
  Tags,
  Ticket,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth, useCurrentUser } from '../../auth/auth-context';
import { cn } from '../../lib/cn';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

function useNavigation() {
  const { can } = useAuth();
  const user = useCurrentUser();
  const main: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    {
      to: '/tickets',
      label: user.role === 'CUSTOMER' ? 'My tickets' : 'Tickets',
      icon: Ticket,
    },
  ];
  const admin: NavItem[] = [
    ...(can(PERMISSIONS.USER_MANAGE) ? [{ to: '/admin/users', label: 'Users', icon: Users }] : []),
    ...(can(PERMISSIONS.CATEGORY_MANAGE)
      ? [{ to: '/admin/categories', label: 'Categories', icon: Tags }]
      : []),
  ];
  return { main, admin };
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 px-2">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
        <LifeBuoy className="size-5" aria-hidden />
      </span>
      <span className="text-base font-semibold tracking-tight text-slate-900">Support Desk</span>
    </Link>
  );
}

function NavSection({ items, title }: { items: NavItem[]; title?: string }) {
  if (items.length === 0) return null;
  return (
    <div>
      {title && (
        <p className="mb-1 px-3 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
          {title}
        </p>
      )}
      <ul className="space-y-0.5">
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )
              }
            >
              <Icon className="size-[18px] shrink-0" aria-hidden />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SidebarContent() {
  const { main, admin } = useNavigation();
  return (
    <div className="flex h-full flex-col gap-6 px-3 py-5">
      <Brand />
      <Link
        to="/tickets/new"
        className="flex h-9 items-center justify-center gap-2 rounded-lg bg-brand-600 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
      >
        <Plus className="size-4" aria-hidden />
        New ticket
      </Link>
      <nav className="flex flex-1 flex-col gap-6" aria-label="Main">
        <NavSection items={main} />
        <NavSection items={admin} title="Administration" />
      </nav>
    </div>
  );
}

function UserMenu() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-lg p-1 pr-2 transition hover:bg-slate-100"
      >
        <Avatar name={user.name} />
        <span className="hidden text-left sm:block">
          <span className="block text-sm leading-tight font-medium text-slate-800">
            {user.name}
          </span>
          <span className="block text-xs leading-tight text-slate-500">
            {ROLE_LABELS[user.role]}
          </span>
        </span>
        <ChevronDown className="hidden size-4 text-slate-400 sm:block" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl bg-white py-1 shadow-lg ring-1 ring-slate-200"
        >
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="truncate text-sm font-medium text-slate-900">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
          <button
            role="menuitem"
            className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setOpen(false);
              navigate('/profile');
            }}
          >
            <UserRound className="size-4 text-slate-400" aria-hidden />
            Profile & security
          </button>
          <button
            role="menuitem"
            className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => void logout()}
          >
            <LogOut className="size-4 text-slate-400" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const q = value.trim();
    navigate(q ? `/tickets?q=${encodeURIComponent(q)}` : '/tickets');
    setValue('');
  };

  return (
    <form onSubmit={onSubmit} role="search" className="relative w-full max-w-md">
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search tickets…"
        title="Search by subject, #number or customer"
        aria-label="Search tickets"
        className="h-9 w-full rounded-lg border-0 bg-slate-100 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-500 focus:bg-white focus:ring-2 focus:ring-brand-500 focus:outline-none"
      />
    </form>
  );
}

export function AppLayout() {
  const location = useLocation();
  // The drawer remembers the path it was opened on, so navigating anywhere closes it.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const mobileOpen = drawerPath === location.pathname;
  const setMobileOpen = (open: boolean) => setDrawerPath(open ? location.pathname : null);

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-slate-200 bg-white lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl">
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-5 right-3"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X className="size-4" />
            </Button>
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/85 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </Button>
          <div className="flex flex-1 justify-start">
            <GlobalSearch />
          </div>
          <UserMenu />
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
