// apps/api/src/services/keepalive.ts
import axios from 'axios';
import { logger } from '../lib/logger';

const AI_URL = (process.env.AI_ENGINE_URL || '').replace(/\/$/, '');

let _lastPingSuccess = 0;

export function markAiEngineAlive(): void {
  _lastPingSuccess = Date.now();
}

async function pingAiEngine(): Promise<boolean> {
  if (!AI_URL) return false;
  try {
    const res = await axios.get(`${AI_URL}/health`, {
      timeout: 20_000,
      headers: { 'User-Agent': 'MCAP-KeepAlive/1.0' },
    });
    if (res.status === 200) {
      _lastPingSuccess = Date.now();
      return true;
    }
    return false;
  } catch (err) {
    logger.debug('AI Engine ping failed', {
      error: err instanceof Error ? err.message : err,
    });
    return false;
  }
}

export function startKeepAlive(): void {
  if (!AI_URL) {
    logger.info('ℹ️ Keep-alive skipped — no AI_ENGINE_URL');
    return;
  }

  const INTERVAL_MS = 8 * 60 * 1000; // 8 min

  // Startup ping
  pingAiEngine().then(ok => {
    logger.info(
      ok ? '✅ AI Engine awake' : '⚠️ AI Engine not responding'
    );
  });

  // Periodic ping
  setInterval(async () => {
    const ok = await pingAiEngine();
    if (ok) logger.debug('💓 AI Engine OK');
    else    logger.warn('💀 AI Engine not responding');
  }, INTERVAL_MS);

  logger.info('✅ Keep-alive started', {
    interval: '8 minutes',
    target:   AI_URL,
  });
}
