'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface UseContentSocketOptions {
  requestId: string;
  enabled?: boolean;
  onProgress?: (data: { progress: number; step: string; [key: string]: unknown }) => void;
  onCompleted?: (data: { requestId: string; artifactCount?: number; totalTokens?: number }) => void;
  onFailed?: (data: { requestId: string; reason?: string; error?: string }) => void;
}

type ProgressPayload = {
  requestId?: string;
  progress?: number;
  percentage?: number;
  step?: string;
  [key: string]: unknown;
};

export function useContentSocket({
  requestId,
  enabled = true,
  onProgress,
  onCompleted,
  onFailed,
}: UseContentSocketOptions) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled || !requestId) return;

    const token =
      typeof window !== 'undefined'
        ? localStorage.getItem('accessToken')
        : null;

    if (!token) {
      console.warn('[Socket] No auth token, skipping connection');
      return;
    }

    const rawApiUrl =
      process.env.NEXT_PUBLIC_API_URL ||
      (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');
    const wsUrl = rawApiUrl.replace(/\/api\/?$/, '').replace(/\/+$/, '');

    console.log('[Socket] Connecting to', wsUrl);

    const socket = io(wsUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 10000,
    });

    socketRef.current = socket;

    const forwardProgress = (data: ProgressPayload) => {
      if (data.requestId !== requestId) return;

      const progress =
        typeof data.progress === 'number'
          ? data.progress
          : typeof data.percentage === 'number'
          ? data.percentage
          : 0;

      const step = typeof data.step === 'string' ? data.step : '';

      console.log('[Socket] Progress:', progress, step);
      onProgress?.({ ...data, progress, step });
    };

    const forwardCompleted = (data: { requestId?: string; artifactCount?: number; totalTokens?: number }) => {
      if (data.requestId !== requestId) return;
      console.log('[Socket] Completed:', data);
      onCompleted?.({
        requestId,
        artifactCount: data.artifactCount,
        totalTokens: data.totalTokens,
      });
    };

    const forwardFailed = (data: { requestId?: string; reason?: string; error?: string }) => {
      if (data.requestId !== requestId) return;
      console.error('[Socket] Failed:', data);
      onFailed?.({
        requestId,
        reason: data.reason,
        error: data.error,
      });
    };

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);

      // request room join with server-side access validation
      socket.emit('subscribe:request', requestId);
    });

    socket.on('subscribed', (data) => {
      console.log('[Socket] Subscribed:', data);
    });

    socket.on('joined', (data) => {
      console.log('[Socket] Joined:', data);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });

    // Worker direct events
    socket.on('content:progress', forwardProgress);
    socket.on('content:completed', forwardCompleted);
    socket.on('content:failed', forwardFailed);

    // Queue bridge events
    socket.on('job:progress', forwardProgress);
    socket.on('job:completed', forwardCompleted);
    socket.on('job:failed', forwardFailed);

    return () => {
      console.log('[Socket] Cleaning up');

      socket.off('content:progress', forwardProgress);
      socket.off('content:completed', forwardCompleted);
      socket.off('content:failed', forwardFailed);

      socket.off('job:progress', forwardProgress);
      socket.off('job:completed', forwardCompleted);
      socket.off('job:failed', forwardFailed);

      socket.off('subscribed');
      socket.off('joined');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [requestId, enabled, onProgress, onCompleted, onFailed]);

  return { socket: socketRef.current };
}
