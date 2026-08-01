import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

const connection = process.env.REDIS_URL
  ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  : new IORedis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      maxRetriesPerRequest: null,
    });

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

export const humanizationQueue = new Queue('humanization', {
  connection: connection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export const exportQueue = new Queue('export', {
  connection: connection as any,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 2000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export const qaQueue = new Queue('qa', {
  connection: connection as any,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

// Queue events for monitoring
export const contentQueueEvents = new QueueEvents('content-generation', { connection: connection as any });

export async function addContentJob(
  requestId: string,
  payload: Omit<ContentJobData, 'requestId'>,
  priority = 0
) {
  return contentQueue.add(
    'generate',
    { requestId, ...payload },
    { priority }
  );
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
  brandProfileId?: string;
  projectId?: string;
  createdBy?: string;
}
