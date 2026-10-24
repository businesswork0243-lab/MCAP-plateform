'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Sparkles,
  Library,
  FolderKanban,
  FileStack,
  Palette,
  BarChart3,
  Users,
  Settings,
  ChevronLeft,
  LogOut,
  Loader2,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NavItem {
  href:   string;
  label:  string;
  Icon:   React.ComponentType<{ className?: string }>;
  roles?: string[];
  exact?: boolean;
  badge?: string;
}

// ─── Nav Config ───────────────────────────────────────────────────────────────

const NAV_ITEMS: NavItem[] = [
  {
    href:  '/dashboard',
    label: 'Dashboard',
    Icon:  LayoutDashboard,
    exact: true,
  },
  {
    href:  '/content/new',
    label: 'New Content',
    Icon:  Sparkles,
    exact: true,
    badge: 'AI',
  },
  {
    href:  '/content',
    label: 'Content Library',
    Icon:  Library,
    exact: true,
  },
  {
    href:  '/projects',
    label: 'Projects',
    Icon:  FolderKanban,
  },
  {
    href:  '/templates',
    label: 'Templates',
    Icon:  FileStack,
  },
  {
    href:  '/brand',
    label: 'Brand Profiles',
    Icon:  Palette,
  },
  {
    href:  '/analytics',
    label: 'Analytics',
    Icon:  BarChart3,
    roles: ['owner', 'admin', 'analyst'],
  },
  {
    href:  '/team',
    label: 'Team',
    Icon:  Users,
    roles: ['owner', 'admin'],
  },
  {
    href:  '/settings',
    label: 'Settings',
    Icon:  Settings,
  },
];

// Role display config
const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  owner:    { label: 'Owner',    color: 'text-violet-400' },
  admin:    { label: 'Admin',    color: 'text-blue-400'   },
  editor:   { label: 'Editor',   color: 'text-green-400'  },
  writer:   { label: 'Writer',   color: 'text-emerald-400' },
  reviewer: { label: 'Reviewer', color: 'text-amber-400'  },
  analyst:  { label: 'Analyst',  color: 'text-cyan-400'   },
  viewer:   { label: 'Viewer',   color: 'text-gray-400'   },
};

// ─── Nav Link Component ───────────────────────────────────────────────────────

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const { Icon } = item;

  // Active detection
  const isActive = item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(item.href + '/');

  // Special case: /content/new should NOT highlight /content
  const isContentNew = item.href === '/content' && pathname === '/content/new';
  const active = isActive && !isContentNew;

  return (
    <Link
      href={item.href}
      className={cn(
        'relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-150 group',
        active
          ? 'bg-violet-500/15 text-white border border-violet-500/20'
          : 'text-gray-500 hover:text-gray-300 hover:bg-white/5 border border-transparent'
      )}
    >
      {/* Active indicator bar */}
      {active && (
        <motion.div
          layoutId="nav-active"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-violet-500 rounded-full"
          transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
        />
      )}

      {/* Icon */}
      <Icon
        className={cn(
          'w-4 h-4 shrink-0 transition-colors',
          active
            ? 'text-violet-400'
            : 'text-gray-600 group-hover:text-gray-400'
        )}
      />

      {/* Label */}
      <span className="flex-1">{item.label}</span>

      {/* Badge */}
      {item.badge && (
        <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-violet-500/20 text-violet-300 rounded-md border border-violet-500/20">
          {item.badge}
        </span>
      )}
    </Link>
  );
}

// ─── Collapsed Nav Link ───────────────────────────────────────────────────────

function CollapsedNavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const { Icon } = item;
  const active = item.exact
    ? pathname === item.href
    : pathname.startsWith(item.href + '/');

  return (
    <Link
      href={item.href}
      title={item.label}
      className={cn(
        'flex items-center justify-center w-10 h-10 mx-auto rounded-xl transition-all',
        active
          ? 'bg-violet-500/15 text-violet-400 border border-violet-500/20'
          : 'text-gray-600 hover:text-gray-300 hover:bg-white/5'
      )}
    >
      <Icon className="w-4 h-4" />
    </Link>
  );
}

// ─── Main Sidebar ─────────────────────────────────────────────────────────────

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);

  const [loggingOut, setLoggingOut] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Filter nav items based on role
  const visibleNavItems = NAV_ITEMS.filter(item => {
    if (!item.roles) return true;
    if (!user?.role) return false;
    return item.roles.includes(user.role);
  });

  const roleConfig = ROLE_CONFIG[user?.role ?? ''] ?? {
    label: user?.role ?? 'User',
    color: 'text-gray-400',
  };

  const handleLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await logout();
      router.replace('/login');
    } finally {
      setLoggingOut(false);
    }
  }, [logout, router]);

  // User initials
  const initials = user?.name
    ?.split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase()
    ?? 'U';

  return (
    <aside
      className={cn(
        'relative shrink-0 h-screen border-r border-white/10 flex flex-col bg-[#0A0A0B] transition-all duration-300',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* ═══ Logo ═══ */}
      <div className="h-14 flex items-center gap-2.5 px-4 border-b border-white/10 shrink-0">
        <div className="w-7 h-7 bg-gradient-to-br from-violet-500 to-violet-700 rounded-lg flex items-center justify-center shrink-0 shadow-lg shadow-violet-500/30">
          <span className="text-white text-xs font-bold">S</span>
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <span className="font-bold text-white text-sm tracking-tight">
              Semantiq
            </span>
            {user?.organizationName && (
              <p className="text-xs text-gray-600 truncate">
                {user.organizationName}
              </p>
            )}
          </div>
        )}
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-gray-600 hover:text-gray-400 transition-colors ml-auto"
        >
          <ChevronLeft
            className={cn(
              'w-4 h-4 transition-transform',
              collapsed && 'rotate-180'
            )}
          />
        </button>
      </div>

      {/* ═══ Navigation ═══ */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {!collapsed && (
          <p className="text-xs text-gray-700 font-medium uppercase tracking-widest px-3 mb-2">
            Navigation
          </p>
        )}

        {visibleNavItems.map(item =>
          collapsed ? (
            <CollapsedNavLink key={item.href} item={item} pathname={pathname} />
          ) : (
            <NavLink key={item.href} item={item} pathname={pathname} />
          )
        )}
      </nav>

      {/* ═══ Organization Info ═══ */}
      {!collapsed && user?.organizationName && (
        <div className="px-3 py-2 border-t border-white/5">
          <div className="px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/8">
            <p className="text-[10px] text-gray-600 uppercase tracking-wide font-semibold">
              Organization
            </p>
            <p className="text-xs font-medium text-gray-300 truncate mt-0.5">
              {user.organizationName}
            </p>
          </div>
        </div>
      )}

      {/* ═══ User Footer ═══ */}
      <div className="border-t border-white/10 p-3 shrink-0">
        {collapsed ? (
          // Collapsed avatar
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            title={`${user?.name ?? 'User'} — Click to logout`}
            className="w-10 h-10 mx-auto rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all"
          >
            {loggingOut ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <span className="text-xs font-bold">{initials}</span>
            )}
          </button>
        ) : (
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/5 transition-all group">
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500/30 to-violet-700/30 border border-violet-500/20 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-violet-300">
                {initials}
              </span>
            </div>

            {/* User info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">
                {user?.name ?? 'User'}
              </p>
              <p className={cn('text-xs truncate', roleConfig.color)}>
                {roleConfig.label}
              </p>
            </div>

            {/* Logout button */}
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              title="Logout"
              className="text-gray-600 hover:text-red-400 transition-all opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/10 rounded-lg"
            >
              {loggingOut ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LogOut className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
