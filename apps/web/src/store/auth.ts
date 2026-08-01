'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '@/lib/api';
import { AxiosError } from 'axios';

// ─── Types ────────────────────────────────────────────────────────────────────

interface User {
  id:               string;
  name:             string;
  email:            string;
  role:             string;
  organizationId:   string;
  organizationName: string;
}

interface RegisterData {
  name:        string;
  email:       string;
  password:    string;
  companyName: string;
}

interface AuthResponse {
  accessToken:  string;
  refreshToken: string;
  token:        string; // backward compat
  user:         User;
}

interface AuthState {
  user:         User | null;
  accessToken:  string | null;
  isLoading:    boolean;
  error:        string | null;

  login:        (email: string, password: string) => Promise<void>;
  register:     (data: RegisterData) => Promise<void>;
  logout:       () => Promise<void>;
  fetchMe:      () => Promise<void>;
  refreshToken: () => Promise<boolean>;
  clearError:   () => void;
  setAuth:      (data: { user: User; accessToken: string; refreshToken: string }) => void;
  setUser:      (user: User | null) => void;
  clearAuth:    () => void;
}

function getApiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof AxiosError) {
    const apiMessage =
      (err.response?.data as { error?: string; message?: string })?.message ||
      (err.response?.data as { error?: string; message?: string })?.error;

    return apiMessage || err.message || fallback;
  }

  if (err instanceof Error) return err.message;
  return fallback;
}

// ─── Auth Store ───────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isLoading: false,
      error: null,

      clearError: () => set({ error: null }),

      setAuth: ({ user, accessToken, refreshToken }) => {
        if (typeof window !== 'undefined') {
          localStorage.setItem('accessToken', accessToken);
          localStorage.setItem('refreshToken', refreshToken);
        }
        set({ user, accessToken });
      },

      setUser: (user) => set({ user }),

      clearAuth: () => {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
        }
        set({ user: null, accessToken: null });
      },

      // ── Login ───────────────────────────────────────────────────────────────
      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });

        try {
          const { data } = await api.post<AuthResponse>('/auth/login', {
            email,
            password,
          });

          const accessToken = data.accessToken || data.token;
          const refreshToken = data.refreshToken;

          if (typeof window !== 'undefined') {
            localStorage.setItem('accessToken', accessToken);
            localStorage.setItem('refreshToken', refreshToken);
          }

          set({
            user: data.user,
            accessToken,
            isLoading: false,
            error: null,
          });
        } catch (err) {
          const message = getApiErrorMessage(err, 'Login failed. Check your credentials.');
          set({ isLoading: false, error: message, user: null, accessToken: null });
          throw err;
        }
      },

      // ── Register ─────────────────────────────────────────────────────────────
      register: async (formData: RegisterData) => {
        set({ isLoading: true, error: null });

        try {
          const { data } = await api.post<AuthResponse>('/auth/register', formData);

          const accessToken = data.accessToken || data.token;
          const refreshToken = data.refreshToken;

          if (typeof window !== 'undefined') {
            localStorage.setItem('accessToken', accessToken);
            localStorage.setItem('refreshToken', refreshToken);
          }

          set({
            user: data.user,
            accessToken,
            isLoading: false,
            error: null,
          });
        } catch (err) {
          const message = getApiErrorMessage(err, 'Registration failed');
          set({ isLoading: false, error: message, user: null, accessToken: null });
          throw err;
        }
      },

      // ── Logout ───────────────────────────────────────────────────────────────
      logout: async () => {
        try {
          await api.post('/auth/logout');
        } catch {
          // Invalidate locally regardless
        } finally {
          if (typeof window !== 'undefined') {
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
            window.location.href = '/login';
          }
          set({ user: null, accessToken: null, error: null });
        }
      },

      // ── Fetch Me ──────────────────────────────────────────────────────────────
      fetchMe: async () => {
        const token =
          typeof window !== 'undefined'
            ? localStorage.getItem('accessToken')
            : null;

        if (!token) return;

        try {
          const { data } = await api.get<User>('/auth/me');
          set({ user: data, error: null });
        } catch (err) {
          if (err instanceof AxiosError) {
            const status = err.response?.status;
            const code = (err.response?.data as { code?: string })?.code;

            if (status === 401 && code === 'TOKEN_EXPIRED') {
              const refreshed = await get().refreshToken();
              if (refreshed) {
                const { data } = await api.get<User>('/auth/me');
                set({ user: data, error: null });
                return;
              }
            }
          }

          if (typeof window !== 'undefined') {
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
          }

          set({ user: null, accessToken: null, error: null });
        }
      },

      // ── Refresh Token ─────────────────────────────────────────────────────────
      refreshToken: async (): Promise<boolean> => {
        const storedRefreshToken = typeof window !== 'undefined' ? localStorage.getItem('refreshToken') : null;

        if (!storedRefreshToken) {
          set({ user: null, accessToken: null });
          return false;
        }

        try {
          const { data } = await api.post<AuthResponse>('/auth/refresh', {
            refreshToken: storedRefreshToken,
          });

          const accessToken = data.accessToken || data.token;
          const refreshToken = data.refreshToken;

          if (typeof window !== 'undefined') {
            localStorage.setItem('accessToken', accessToken);
            localStorage.setItem('refreshToken', refreshToken);
          }

          set({
            user: data.user,
            accessToken,
          });

          return true;
        } catch {
          if (typeof window !== 'undefined') {
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
          }
          set({ user: null, accessToken: null });
          return false;
        }
      },
    }),
    {
      name: 'mcap-auth',
      partialize: (state) => ({
        user: state.user,
      }),
    }
  )
);
