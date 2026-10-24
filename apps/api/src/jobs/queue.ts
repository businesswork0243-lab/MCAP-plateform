import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis, { RedisOptions } from 'ioredis';
import { logger } from '../lib/logger';

function createRedisConnection(): IORedis {
  const redisUrl = process.env.REDIS_URL;

  const options: RedisOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    keepAlive: 10000,
    retryStrategy(times) {
      return Math.min(times * 100, 3000);
    },
  };

  if (redisUrl) {
    if (redisUrl.startsWith('rediss://')) {
      options.tls = { rejectUnauthorized: false };
    }
    const client = new IORedis(redisUrl, options);
    client.on('error', (err: any) => {
      if (err.code === 'ECONNRESET' || err.code === 'EPIPE') return;
      logger.warn('Redis connection issue:', { error: err.message });
    });
    return client;
  }

  const client = new IORedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    maxRetriesPerRequest: null,
    ...options,
  });

  client.on('error', (err: any) => {
    if (err.code === 'ECONNRESET') return;
    logger.warn('Redis connection issue:', { error: err.message });
  });

  return client;
}

const connection = createRedisConnection();

function attachQueueErrorHandlers(q: Queue, name: string) {
  q.on('error', (err: any) => {
    if (err.code === 'ECONNRESET') return;
    logger.warn(`Queue [${name}] error:`, { error: err.message });
  });
}

// Queue definitions
export const contentQueue = new Queue('content-generation', {
  connection: connection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});
attachQueueErrorHandlers(contentQueue, 'content-generation');

export const humanizationQueue = new Queue('humanization', {
  connection: connection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
attachQueueErrorHandlers(humanizationQueue, 'humanization');

export const exportQueue = new Queue('export', {
  connection: connection as any,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 2000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});
attachQueueErrorHandlers(exportQueue, 'export');

export const qaQueue = new Queue('qa', {
  connection: connection as any,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
attachQueueErrorHandlers(qaQueue, 'qa');

// Queue events for monitoring — MUST have its own dedicated connection for Pub/Sub
export const contentQueueEvents = new QueueEvents('content-generation', {
  connection: createRedisConnection() as any,
});
contentQueueEvents.on('error', (err: any) => {
  if (err.code === 'ECONNRESET' || err.code === 'EPIPE') return;
  logger.warn('contentQueueEvents error:', { error: err.message });
});

let _contentExecutor: ((data: ContentJobData) => Promise<void>) | null = null;

export function registerContentExecutor(executor: (data: ContentJobData) => Promise<void>) {
  _contentExecutor = executor;
}

export async function addContentJob(
  requestId: string,
  payload: Omit<ContentJobData, 'requestId'>,
  priority = 0
) {
  const jobData: ContentJobData = { requestId, ...payload };
  let queued = false;

  try {
    // Attempt BullMQ with a 2-second timeout
    const addPromise = contentQueue.add('generate', jobData, { priority });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Redis add timeout')), 2000)
    );
    await Promise.race([addPromise, timeoutPromise]);
    queued = true;
    logger.info('✅ Job queued via BullMQ', { requestId });
  } catch (err: any) {
    logger.warn('⚠️ BullMQ queue add skipped (Upstash socket timeout). Using direct in-process execution:', {
      error: err?.message,
      requestId,
    });
  }

  // If Redis timed out or threw (e.g. Upstash idle reset), execute directly in-process
  if (!queued) {
    setImmediate(() => {
      if (_contentExecutor) {
        _contentExecutor(jobData).catch((err) => {
          logger.error('In-process content generation failed:', {
            error: err instanceof Error ? err.message : err,
            requestId,
          });
        });
      } else {
        logger.error('No content executor registered for fallback', { requestId });
      }
    });
  }
}

export async function addHumanizationJob(requestId: string, artifactId: string) {
  return humanizationQueue.add('humanize', { requestId, artifactId });
}

export async function addQAJob(requestId: string, artifactId: string) {
  return qaQueue.add('qa-check', { requestId, artifactId });
}

export async function addExportJob(
  requestId: string,
  format: 'pdf' | 'docx' | 'markdown' | 'html'
) {
  return exportQueue.add('export', { requestId, format });
}

export { connection as redisConnection };

export interface ContentJobData {
  requestId: string;
  organizationId: string;
  topic: string;
  objective?: string;
  context?: string;
  audience?: string;
  icp_description?: string;
  perspective?: string;
  writing_structure?: string;
  custom_structure_flow?: string[] | null;
  cta?: string;
  targetPlatforms?: string[];
  targetPlatform?: string; // backward compatibility
  brandProfile?: Record<string, unknown> | null;
  enableHumanization?: boolean;
  humanizationIntensity?: string;
  enableQA?: boolean;
  language?: string;
  keywords?: string[];
  specialInstructions?: string;
  seoEnabled?: boolean;
  seoSettings?: Record<string, unknown>;
  tonalitySpectrum?: Record<string, number>;
  wordCount?: number;
  readingLevel?: string;
  brandProfileId?: string;
  projectId?: string;
  createdBy?: string;
}
