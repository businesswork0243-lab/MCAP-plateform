'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { useAuthStore } from '@/store/auth';

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="flex h-screen overflow-hidden bg-[#080809]">
      <div className="w-60 shrink-0 h-screen border-r border-white/10 flex flex-col">
        <div className="h-14 flex items-center gap-2 px-4 border-b border-white/10">
          <div className="w-7 h-7 bg-white/10 rounded-lg animate-pulse" />
          <div className="w-16 h-4 bg-white/10 rounded animate-pulse" />
        </div>
        <div className="flex-1 px-2 py-3 space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl">
              <div className="w-4 h-4 bg-white/10 rounded animate-pulse" />
              <div
                className="h-3 bg-white/10 rounded animate-pulse"
                style={{ width: `${60 + i * 5}px` }}
              />
            </div>
          ))}
        </div>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-white/10 animate-pulse" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-24 bg-white/10 rounded animate-pulse" />
              <div className="h-2.5 w-16 bg-white/10 rounded animate-pulse" />
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 p-8 space-y-6">
        <div className="h-8 w-48 bg-white/10 rounded-xl animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-32 bg-white/5 rounded-2xl border border-white/10 animate-pulse"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

// ─── Layout ───────────────────────────────────────────────────────────────────

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router   = useRouter();
  const pathname = usePathname();

  const user         = useAuthStore(s => s.user);
  const fetchMe      = useAuthStore(s => s.fetchMe);
  const refreshToken = useAuthStore(s => s.refreshToken);

  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      // ✅ FIX: Direct localStorage check
      const accessToken = typeof window !== 'undefined'
        ? localStorage.getItem('accessToken')
        : null;

      const storedRefresh = typeof window !== 'undefined'
        ? localStorage.getItem('refreshToken')
        : null;

      // No tokens at all — redirect immediately
      if (!accessToken && !storedRefresh) {
        if (cancelled) return;
        const returnTo = encodeURIComponent(pathname);
        router.replace(`/login?returnTo=${returnTo}`);
        return;
      }

      // ✅ FIX: If user already in store + has token — no need to refetch
      if (user && accessToken) {
        if (cancelled) return;
        setAuthStatus('authenticated');
        return;
      }

      // Try fetchMe (handles token refresh internally via interceptor)
      try {
        await fetchMe();
        if (cancelled) return;
        setAuthStatus('authenticated');
      } catch {
        if (cancelled) return;

        // Try explicit refresh as last resort
        if (storedRefresh) {
          const refreshed = await refreshToken();
          if (cancelled) return;

          if (refreshed) {
            setAuthStatus('authenticated');
          } else {
            router.replace('/login?reason=session_expired');
          }
        } else {
          router.replace('/login?reason=session_expired');
        }
      }
    }

    checkAuth();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (authStatus === 'checking') return <DashboardSkeleton />;
  if (authStatus === 'unauthenticated') return null;

  return (
    <div className="flex h-screen overflow-hidden bg-[#080809]">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
