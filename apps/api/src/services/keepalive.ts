import axios from 'axios';
import { logger } from '../lib/logger';

const AI_URL  = (process.env.AI_ENGINE_URL || '').replace(/\/$/, '');
const API_URL = (process.env.RENDER_EXTERNAL_URL || process.env.WEB_URL || '').replace(/\/$/, '');

let _lastPingSuccess = 0;

export function markAiEngineAlive(): void {
  _lastPingSuccess = Date.now();
}

async function pingAiEngine(): Promise<boolean> {
  if (!AI_URL) return false;
  try {
    const res = await axios.get(`${AI_URL}/health`, { timeout: 20_000 });
    if (res.status === 200) {
      _lastPingSuccess = Date.now();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ✅ FIX: Self ping added
async function pingSelf(): Promise<void> {
  if (!API_URL) return;
  try {
    await axios.get(`${API_URL}/health`, { timeout: 10_000 });
    logger.debug('💓 Self keep-alive: OK');
  } catch {
    logger.warn('💀 Self keep-alive: failed');
  }
}

export function startKeepAlive(): void {
  if (!AI_URL && !API_URL) {
    logger.warn('⚠️ No URLs set for keep-alive');
    return;
  }

  const INTERVAL_MS = 8 * 60 * 1000; // 8 minutes

  // Startup ping
  pingAiEngine().then(ok => {
    logger.info(
      ok
        ? '✅ AI Engine keep-alive: engine awake'
        : '⚠️ AI Engine keep-alive: engine sleeping'
    );
  });

  // AI Engine keep-alive
  setInterval(async () => {
    const ok = await pingAiEngine();
    if (ok) {
      logger.debug('💓 Keep-alive: AI Engine OK');
    } else {
      logger.warn('💀 Keep-alive: AI Engine not responding');
    }
  }, INTERVAL_MS);

  // ✅ Self keep-alive
  if (API_URL) {
    setInterval(pingSelf, INTERVAL_MS);
    logger.info('✅ Self keep-alive started', { url: API_URL });
  }

  logger.info('✅ Keep-alive started', {
    interval:    '8 minutes',
    aiEngineUrl: AI_URL || 'not set',
    selfUrl:     API_URL || 'not set',
  });
}
