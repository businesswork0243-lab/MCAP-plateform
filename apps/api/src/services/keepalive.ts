// apps/api/src/services/keepalive.ts
/**
 * AI Engine Keep-Alive Service v2.0
 * Railway pe sleep nahi hoti, lekin cold start/crash ke baad gap hota hai.
 * Shared state — contentWorker.ts bhi yahi use karta hai.
 */

import axios from 'axios';
import { logger } from '../lib/logger';

const AI_URL = (process.env.AI_ENGINE_URL || '').replace(/\/$/, '');

// ── Shared State ──────────────────────────────────────────────────────────────
let _lastSeenAt = 0;
let _isHealthy = false;
let _totalPings = 0;
let _failedPings = 0;
let _intervalTimer: ReturnType<typeof setInterval> | null = null;

const HEALTHY_WINDOW_MS = 10 * 60 * 1000; // 10 min
const PING_TIMEOUT_MS = 15_000;          // 15s
const PING_INTERVAL_MS = 7 * 60 * 1000;  // 7 min

// ── Public API ────────────────────────────────────────────────────────────────

export function markAiEngineAlive(): void {
  _lastSeenAt = Date.now();
  _isHealthy = true;
  _failedPings = 0;
}

export function isAiEngineHealthy(): boolean {
  return _isHealthy && (Date.now() - _lastSeenAt < HEALTHY_WINDOW_MS);
}

export function getAiEngineStats() {
  return {
    healthy: isAiEngineHealthy(),
    lastSeenAt: _lastSeenAt ? new Date(_lastSeenAt).toISOString() : null,
    lastSeenAgoMs: _lastSeenAt ? Date.now() - _lastSeenAt : -1,
    totalPings: _totalPings,
    failedPings: _failedPings,
    url: AI_URL || 'not configured',
  };
}

// ── Core Ping ─────────────────────────────────────────────────────────────────

async function pingOnce(): Promise<boolean> {
  if (!AI_URL) return false;
  _totalPings++;
  try {
    const res = await axios.get(`${AI_URL}/health`, {
      timeout: PING_TIMEOUT_MS,
      headers: { 'User-Agent': 'MCAP-KeepAlive/2.0' },
    });
    if (res.status === 200) {
      markAiEngineAlive();
      return true;
    }
    _failedPings++;
    _isHealthy = false;
    return false;
  } catch (err) {
    _failedPings++;
    _isHealthy = false;
    if (_failedPings >= 2) {
      logger.warn('AI Engine keep-alive ping failed', {
        consecutiveFails: _failedPings,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return false;
  }
}

// ── Wait Until Ready ──────────────────────────────────────────────────────────

export async function waitForAiEngine(
  maxWaitMs = 3 * 60 * 1000
): Promise<boolean> {
  if (isAiEngineHealthy()) {
    logger.info('✅ AI Engine already healthy, skipping wait');
    return true;
  }

  logger.info('⏳ Waiting for AI Engine...', { maxWaitMs, url: AI_URL });

  const startTime = Date.now();
  const delays = [0, 10_000, 15_000, 20_000, 25_000];
  let attempt = 0;

  while (Date.now() - startTime < maxWaitMs) {
    const delay = delays[Math.min(attempt, delays.length - 1)];

    if (delay > 0) {
      await new Promise(r => setTimeout(r, delay));
    }

    if (Date.now() - startTime >= maxWaitMs) break;

    attempt++;
    const elapsedSec = Math.round((Date.now() - startTime) / 1000);

    logger.info(`🔄 AI Engine ping attempt ${attempt}`, { elapsedSec });

    const ok = await pingOnce();
    if (ok) {
      logger.info(`✅ AI Engine ready (attempt ${attempt}, ${elapsedSec}s)`);
      return true;
    }

    logger.warn(`⏳ Not ready yet (attempt ${attempt}, ${elapsedSec}s)`);
  }

  logger.error(`❌ AI Engine timeout after ${Math.round((Date.now() - startTime) / 1000)}s`);
  return false;
}

// ── Start / Stop ──────────────────────────────────────────────────────────────

export function startKeepAlive(): void {
  if (!AI_URL) {
    logger.info('ℹ️ Keep-alive skipped — AI_ENGINE_URL not set');
    return;
  }
  if (_intervalTimer) {
    logger.warn('Keep-alive already running');
    return;
  }

  // Startup ping (non-blocking)
  pingOnce().then(ok => {
    logger.info(ok
      ? `✅ AI Engine alive on startup | url=${AI_URL}`
      : `⚠️ AI Engine not responding on startup — will retry every ${PING_INTERVAL_MS / 60000}min`
    );
  });

  _intervalTimer = setInterval(async () => {
    const ok = await pingOnce();
    if (ok) logger.debug('💓 AI Engine keep-alive OK');
    else logger.warn('💀 AI Engine keep-alive FAILED', { consecutiveFails: _failedPings });
  }, PING_INTERVAL_MS);

  logger.info('✅ Keep-alive started', {
    interval: `${PING_INTERVAL_MS / 60000}min`,
    timeout: `${PING_TIMEOUT_MS / 1000}s`,
    target: AI_URL,
    healthyWindow: `${HEALTHY_WINDOW_MS / 60000}min`,
  });
}

export function stopKeepAlive(): void {
  if (_intervalTimer) {
    clearInterval(_intervalTimer);
    _intervalTimer = null;
    logger.info('Keep-alive stopped');
  }
}