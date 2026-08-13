'use client';

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

// ─── Base URL ─────────────────────────────────────────────────────────────────

const RAW_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  'https://mcap-platefrom-production.up.railway.app';

function ensureApiPath(url: string): string {
  const clean = url.replace(/\/+$/, '');
  return clean.endsWith('/api') ? clean : `${clean}/api`;
}

const API_BASE_URL = ensureApiPath(RAW_BASE);

if (typeof window !== 'undefined') {
  console.log('[API] Base URL:', API_BASE_URL);
}

// ─── Axios Instances ──────────────────────────────────────────────────────────

// Standard API calls (30s)
export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// ✅ AI operations — longer timeouts
export const aiApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 240_000, // 4 min — rule engine ke saath kaafi hai
  headers: { 'Content-Type': 'application/json' },
});

// ✅ Content generation — longest timeout
export const generationApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 360_000, // 6 min — full pipeline ke liye
  headers: { 'Content-Type': 'application/json' },
});

// ─── Token Attach ─────────────────────────────────────────────────────────────

const attachToken = (config: InternalAxiosRequestConfig) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
};

api.interceptors.request.use(attachToken);
aiApi.interceptors.request.use(attachToken);
generationApi.interceptors.request.use(attachToken);

// ─── Response Interceptor: Auto-refresh on 401 ───────────────────────────────

interface QueueItem {
  resolve: (token: string) => void;
  reject:  (err: unknown)  => void;
}

let isRefreshing = false;
let failedQueue: QueueItem[] = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error)      reject(error);
    else if (token) resolve(token);
  });
  failedQueue = [];
};

const refreshTokenCall = async (): Promise<string | null> => {
  if (typeof window === 'undefined') return null;

  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return null;

  try {
    const { data } = await axios.post(
      `${API_BASE_URL}/auth/refresh`,
      { refreshToken },
      { headers: { 'Content-Type': 'application/json' } }
    );
    const newToken = data.accessToken || data.token;
    if (newToken) {
      localStorage.setItem('accessToken', newToken);
      if (data.refreshToken) {
        localStorage.setItem('refreshToken', data.refreshToken);
      }
      return newToken;
    }
    return null;
  } catch {
    return null;
  }
};

const handleUnauthorized = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  const publicPaths = [
    '/login', '/register', '/',
    '/forgot-password', '/reset-password',
  ];
  if (!publicPaths.some(p => window.location.pathname === p)) {
    window.location.href = '/login';
  }
};

const setupResponseInterceptor = (instance: typeof api) => {
  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & {
        _retry?: boolean;
      };

      if (!error.response)                   return Promise.reject(error);
      if (error.response.status !== 401)     return Promise.reject(error);
      if (originalRequest._retry)            return Promise.reject(error);

      const url = originalRequest.url || '';
      if (
        url.includes('/auth/refresh') ||
        url.includes('/auth/login')   ||
        url.includes('/auth/register')
      ) {
        return Promise.reject(error);
      }

      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return instance(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing            = true;

      try {
        const newToken = await refreshTokenCall();
        if (!newToken) {
          processQueue(error, null);
          handleUnauthorized();
          return Promise.reject(error);
        }
        processQueue(null, newToken);
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
        }
        return instance(originalRequest);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        handleUnauthorized();
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }
  );
};

setupResponseInterceptor(api);
setupResponseInterceptor(aiApi);
setupResponseInterceptor(generationApi);

export default api;