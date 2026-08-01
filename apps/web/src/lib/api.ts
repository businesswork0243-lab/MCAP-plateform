'use client';

import axios from 'axios';

// ── Base URL ──────────────────────────────────────────────────

const RAW_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  'https://mcap-platefrom-production.up.railway.app';

function ensureApiPath(url: string): string {
  const clean = url.replace(/\/+$/, '');
  return clean.endsWith('/api') ? clean : `${clean}/api`;
}

const API_BASE_URL = ensureApiPath(RAW_BASE);

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

export const aiApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 180_000,
  headers: { 'Content-Type': 'application/json' },
});

// Interceptor to attach Authorization header
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

aiApi.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

export default api;