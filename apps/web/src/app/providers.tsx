'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth';

// ✅ FIX: QueryClient module level pe banao
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:            60_000,
      retry:                1,
      refetchOnWindowFocus: false,
    },
  },
});

// ─── Auth Initializer ─────────────────────────────────────────────────────────

function AuthInitializer() {
  const fetchMe      = useAuthStore(s => s.fetchMe);
  const refreshToken = useAuthStore(s => s.refreshToken);
  const user         = useAuthStore(s => s.user);
  const initialized  = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // ✅ FIX: Direct localStorage check — no tokenManager dependency
    const accessToken = typeof window !== 'undefined'
      ? localStorage.getItem('accessToken')
      : null;

    const storedRefresh = typeof window !== 'undefined'
      ? localStorage.getItem('refreshToken')
      : null;

    if (accessToken) {
      // Token exists — fetch fresh user data
      fetchMe().catch(() => {
        // fetchMe failed internally — it handles its own recovery
      });
    } else if (storedRefresh) {
      // No access token but refresh token exists — try refresh
      refreshToken().then(success => {
        if (success) fetchMe();
      });
    }
    // If neither token exists — user is not logged in, no action needed
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// ─── Providers ────────────────────────────────────────────────────────────────

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthInitializer />
      {children}
    </QueryClientProvider>
  );
}
