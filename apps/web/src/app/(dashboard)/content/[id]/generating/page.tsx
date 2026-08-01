'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useContentSocket } from '@/hooks/useContentSocket';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

// ─── Progress Step Config ─────────────────────────────────────────────────────

const PROGRESS_STEPS = [
  { min: 0,   max: 15,  label: 'Initializing pipeline',    icon: '⚙️', key: 'initializing'          },
  { min: 15,  max: 30,  label: 'Fetching brand context',   icon: '🏢', key: 'fetching_brand_context' },
  { min: 30,  max: 50,  label: 'Writing canonical draft',  icon: '✍️', key: 'writing_canonical_draft'},
  { min: 50,  max: 68,  label: 'Platform optimization',    icon: '📱', key: 'platform_optimization'  },
  { min: 68,  max: 80,  label: 'Brand alignment',          icon: '🎯', key: 'brand_alignment'        },
  { min: 80,  max: 91,  label: 'Humanizing content',       icon: '✦',  key: 'humanizing_content'     },
  { min: 91,  max: 97,  label: 'Quality assurance',        icon: '✓',  key: 'quality_assurance'      },
  { min: 97,  max: 100, label: 'Saving results',           icon: '💾', key: 'saving_results'         },
];

function getCurrentStep(progress: number, stepKey?: string) {
  // Priority: step key from backend
  if (stepKey) {
    const found = PROGRESS_STEPS.find(s => s.key === stepKey);
    if (found) return found;
  }
  
  // Fallback: match by progress range
  return PROGRESS_STEPS.find(s => progress >= s.min && progress < s.max)
    ?? PROGRESS_STEPS[PROGRESS_STEPS.length - 1];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GeneratingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [progress, setProgress] = useState(0);
  const [currentStepKey, setCurrentStepKey] = useState<string>('initializing');
  const [status, setStatus] = useState<'running' | 'done' | 'failed'>('running');
  const [failReason, setFailReason] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);

  // ── Elapsed time counter ────────────────────────────────────────
  useEffect(() => {
    if (status !== 'running') return;
    
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    
    return () => clearInterval(timer);
  }, [status]);

  // ── Polling as fallback for status ─────────────────────────────
  const { data } = useQuery({
    queryKey: ['content-generating', id],
    queryFn: () => api.get(`/content/jobs/${id}`).then((r: any) => r.data),
    refetchInterval: status === 'running' ? 5_000 : false,
    enabled: !!id && status === 'running',
  });

  // ── Check DB status ────────────────────────────────────────────
  useEffect(() => {
    const s = data?.request?.status;

    if (['approved', 'awaiting_review', 'completed'].includes(s)) {
      setProgress(100);
      setStatus('done');
      setTimeout(() => router.replace(`/content/${id}`), 1500);
      return;
    }

    if (['generation_failed', 'failed'].includes(s)) {
      setStatus('failed');
      setFailReason(
        data?.request?.error_message || 'Generation failed. Please try again.'
      );
      return;
    }

    if (['queued', 'running', 'processing'].includes(s)) {
      setStatus('running');
    }
  }, [data, id, router]);

  // ── WebSocket handlers ─────────────────────────────────────────
  const handleProgress = useCallback((data: { progress: number; step: string }) => {
    console.log('[Progress]', data);
    
    if (typeof data.progress === 'number') {
      setProgress((prev) => Math.max(prev, data.progress)); // Never go backwards
    }
    
    if (data.step) {
      setCurrentStepKey(data.step);
    }
  }, []);

  const handleCompleted = useCallback(() => {
    console.log('[Completed]');
    setProgress(100);
    setStatus('done');
    setTimeout(() => router.replace(`/content/${id}`), 1_500);
  }, [id, router]);

  const handleFailed = useCallback((data: { reason?: string; error?: string }) => {
    console.log('[Failed]', data);
    setStatus('failed');
    setFailReason(data.reason || data.error || 'Generation failed');
  }, []);

  useContentSocket({
    requestId: id,
    enabled:   status === 'running',
    onProgress: handleProgress,
    onCompleted: handleCompleted,
    onFailed: handleFailed,
  });

  // ── Timeout safety net ─────────────────────────────────────────
  useEffect(() => {
    const TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes

    const timeout = setTimeout(() => {
      if (status === 'running' && progress < 100) {
        setStatus('failed');
        setFailReason(
          'Generation is taking longer than expected. The AI engine may still be waking up or processing. Please retry in a moment.'
        );
      }
    }, TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [status, progress]);

  const currentStep = getCurrentStep(progress, currentStepKey);

  return (
    <div className="min-h-screen bg-[#080809] flex flex-col items-center justify-center gap-10 p-6">

      {/* ── Status Icon ── */}
      <AnimatePresence mode="wait">
        {status === 'running' && (
          <motion.div
            key="running"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            className="relative"
          >
            <div className="w-24 h-24 rounded-full border-2 border-violet-500/20 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-violet-500 animate-spin" />
              <span className="text-3xl">{currentStep.icon}</span>
            </div>
          </motion.div>
        )}

        {status === 'done' && (
          <motion.div
            key="done"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-24 h-24 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center"
          >
            <span className="text-4xl">✓</span>
          </motion.div>
        )}

        {status === 'failed' && (
          <motion.div
            key="failed"
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-24 h-24 rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center"
          >
            <span className="text-4xl">✗</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Title ── */}
      <div className="text-center">
        <AnimatePresence mode="wait">
          <motion.h2
            key={status}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="text-xl font-semibold text-white"
          >
            {status === 'running' ? 'Generating Content'  :
             status === 'done'    ? 'Content Ready!'       :
             'Generation Failed'}
          </motion.h2>
        </AnimatePresence>

        <AnimatePresence mode="wait">
          <motion.p
            key={currentStep.label}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-sm text-gray-500 mt-2"
          >
            {status === 'running' ? currentStep.label :
             status === 'done'    ? 'Redirecting to your content...' :
             failReason}
          </motion.p>
        </AnimatePresence>

        {/* Elapsed time indicator */}
        {status === 'running' && elapsedSec > 5 && (
          <p className="text-xs text-gray-700 mt-2">
            {elapsedSec}s elapsed {elapsedSec > 45 && '· AI Engine may be waking up...'}
          </p>
        )}
      </div>

      {/* ── Progress Bar ── */}
      {status === 'running' && (
        <div className="w-full max-w-md space-y-3">
          <div className="flex justify-between text-xs">
            <span className="text-gray-600">Progress</span>
            <span className="text-violet-400 font-medium">{progress}%</span>
          </div>

          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-violet-600 to-violet-400 rounded-full"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>

          {/* Step pills */}
          <div className="flex flex-wrap gap-2 justify-center mt-4">
            {PROGRESS_STEPS.map((s, i) => {
              const done    = progress >= s.max;
              const current = s.key === currentStepKey || (progress >= s.min && progress < s.max);
              return (
                <div
                  key={i}
                  className={`
                    flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs
                    border transition-all duration-300
                    ${done
                      ? 'bg-violet-500/20 border-violet-500/30 text-violet-300'
                      : current
                      ? 'bg-violet-600/30 border-violet-500/50 text-white shadow-lg shadow-violet-500/20'
                      : 'bg-white/3 border-white/8 text-gray-600'
                    }
                  `}
                >
                  <span>{s.icon}</span>
                  <span>{s.label}</span>
                  {done && <span className="text-violet-400">✓</span>}
                  {current && !done && (
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse ml-1" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Failed Actions ── */}
      {status === 'failed' && (
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/content/new')}
            className="px-5 py-2.5 text-sm text-gray-400 border border-white/10 rounded-xl hover:border-white/20 transition-all"
          >
            ← Try Again
          </button>
          <button
            onClick={() => router.replace(`/content/${id}`)}
            className="px-5 py-2.5 text-sm text-white bg-violet-600 hover:bg-violet-700 rounded-xl transition-all"
          >
            View Details
          </button>
        </div>
      )}
    </div>
  );
}
