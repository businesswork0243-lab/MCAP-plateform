// apps/api/src/jobs/workers/contentWorker.ts
import { Worker, Job } from 'bullmq';
import axios, { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/connection';
import { logger } from '../../lib/logger';
import { ContentJobData } from '../queue';
import { emitToOrg } from '../../services/websocket';

// ── Config ────────────────────────────────────────────────────────────────────

const AI_ENGINE_URL = (
  process.env.AI_ENGINE_URL || 'http://localhost:8000'
).replace(/\/$/, ''); // Trailing slash remove karo

const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 180_000;

// ── Redis Connection ──────────────────────────────────────────────────────────

function getRedisConnection() {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    return {
      url: redisUrl,
      enableReadyCheck: false,
      maxRetriesPerRequest: null as unknown as number,
    };
  }
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    enableReadyCheck: false,
    maxRetriesPerRequest: null as unknown as number,
  };
}

// ── AI Engine Status (Shared State) ──────────────────────────────────────────

let _aiEngineLastSeen = 0; // Last successful ping timestamp

function markAiEngineAwake() {
  _aiEngineLastSeen = Date.now();
}

function isAiEngineLikelyAwake(): boolean {
  // Agar last 8 minute mein ping hua tha toh assume awake hai
  return Date.now() - _aiEngineLastSeen < 8 * 60 * 1000;
}

// ── Wake Up AI Engine ─────────────────────────────────────────────────────────

async function wakeUpAIEngine(): Promise<boolean> {
  // Agar recently awake tha toh skip karo
  if (isAiEngineLikelyAwake()) {
    logger.info('✅ AI Engine recently seen, skipping wake-up ping');
    return true;
  }

  logger.info('Pinging AI Engine to wake it up...', { url: AI_ENGINE_URL });

  // Progressive wait strategy:
  // Attempt 1: wait 0s  (immediate check)
  // Attempt 2: wait 15s
  // Attempt 3: wait 20s
  // Attempt 4: wait 25s
  // Attempt 5: wait 30s
  // Attempt 6: wait 30s
  // Attempt 7: wait 30s
  // Attempt 8: wait 30s
  // Total max wait: ~3.5 minutes
  const waitsBetween = [0, 15_000, 20_000, 25_000, 30_000, 30_000, 30_000, 30_000];
  const maxAttempts = waitsBetween.length;

  for (let i = 0; i < maxAttempts; i++) {
    // Wait before attempt (except first)
    if (waitsBetween[i] > 0) {
      await new Promise(r => setTimeout(r, waitsBetween[i]));
    }

    try {
      const res = await axios.get(`${AI_ENGINE_URL}/health`, {
        timeout: 12_000, // 12s per ping attempt
      });

      if (res.status === 200) {
        markAiEngineAwake();
        logger.info(`✅ AI Engine is awake (attempt ${i + 1}/${maxAttempts})`);
        return true;
      }
    } catch {
      const elapsedSec = Math.round(
        waitsBetween.slice(0, i + 1).reduce((a, b) => a + b, 0) / 1000
      );
      logger.warn(
        `⏳ AI Engine waking up... attempt ${i + 1}/${maxAttempts} | elapsed: ~${elapsedSec}s`
      );
    }
  }

  logger.error('❌ AI Engine failed to wake up after ~3.5 minutes');
  return false;
}

// ── DB Helpers ────────────────────────────────────────────────────────────────

async function updateRequestStatus(
  requestId: string,
  status: string,
  errorMessage?: string
): Promise<void> {
  try {
    const updates: string[] = ['status = $1', 'updated_at = NOW()'];
    const params: unknown[] = [status, errorMessage ?? null, requestId];

    if (status === 'completed' || status === 'awaiting_review') {
      updates.push('completed_at = NOW()');
    }
    if (status === 'processing' || status === 'running') {
      updates.push('processing_started_at = COALESCE(processing_started_at, NOW())');
    }

    await query(
      `UPDATE content_requests
       SET ${updates.join(', ')},
           error_message = $2
       WHERE id = $3`,
      params
    );
  } catch (err) {
    logger.error('Failed to update status', { requestId, status, err });
  }
}

async function logAgentExecution(
  requestId: string,
  agentName: string,
  status: 'started' | 'completed' | 'failed',
  data: {
    tokensUsed?: number;
    durationMs?: number;
    errorMessage?: string;
  } = {}
): Promise<void> {
  try {
    await query(
      `INSERT INTO agent_executions
        (id, content_request_id, request_id, agent_name, agent_type,
         status, tokens_used, duration_ms, error_message, created_at)
       VALUES ($1::uuid, $2::uuid, $2::uuid, $3::varchar, $3::text,
               $4::text, $5::integer, $6::integer, $7::text, NOW())`,
      [
        uuidv4(),
        requestId,
        agentName,
        status,
        data.tokensUsed ?? null,
        data.durationMs ?? null,
        data.errorMessage ?? null,
      ]
    );
  } catch (err) {
    // Non-critical
    logger.warn('Failed to log agent execution', {
      err: err instanceof Error ? err.message : err,
      agentName,
    });
  }
}

async function saveArtifact(
  requestId: string,
  platform: string,
  contentType: string,
  body: string,
  extraMetadata: Record<string, unknown> = {}
): Promise<string> {
  const id = uuidv4();
  const metadata = { platform, contentType, ...extraMetadata };

  await query(
    `INSERT INTO artifacts
      (id, content_request_id, agent_type, content, status, metadata, version)
     VALUES ($1, $2, $3, $4, 'generated', $5, 1)`,
    [id, requestId, contentType, body, JSON.stringify(metadata)]
  );

  logger.debug('Artifact saved', {
    id,
    requestId,
    platform,
    contentType,
    bodyLength: body.length,
  });

  return id;
}

// ── Pipeline Call ─────────────────────────────────────────────────────────────

interface PipelineResponse {
  artifacts: Array<{
    platform: string;
    finalContent: string;
    canonicalDraft: string;
    platformVariant: string;
    brandAligned: string;
    humanized: string;
    qa: Record<string, unknown>;
    overallScore: number;
    passed: boolean;
  }>;
  canonicalDraft: string;
  totalTokensUsed: number;
}

async function callFullPipeline(jobData: ContentJobData): Promise<PipelineResponse> {
  const payload = {
    topic:                 jobData.topic,
    objective:             jobData.objective || 'Build thought leadership',
    context:               jobData.context || '',
    audience:              jobData.audience || 'General Business',
    icp_description:       jobData.icp_description || '',
    perspective:           jobData.perspective || 'Founder',
    writing_structure:     jobData.writing_structure || 'thesis',
    cta:                   jobData.cta || '',
    targetPlatforms:       jobData.targetPlatforms || ['linkedin_post'],
    brandProfile:          jobData.brandProfile || null,
    enableHumanization:    jobData.enableHumanization ?? true,
    humanizationIntensity: jobData.humanizationIntensity || 'medium',
    enableQA:              jobData.enableQA ?? true,
    language:              jobData.language || 'English',
    keywords:              jobData.keywords || [],
    specialInstructions:   jobData.specialInstructions || '',
    seoEnabled:            jobData.seoEnabled ?? false,
    seoSettings:           jobData.seoSettings || {},
  };

  logger.info('📡 Calling AI Engine /pipeline/run', {
    topic: payload.topic.slice(0, 60),
    platforms: payload.targetPlatforms,
    timeout: `${AI_TIMEOUT_MS}ms`,
  });

  const response = await axios.post<PipelineResponse>(
    `${AI_ENGINE_URL}/pipeline/run`,
    payload,
    {
      timeout: AI_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  if (!response.data?.artifacts) {
    throw new Error('AI Engine returned invalid response - missing artifacts');
  }

  return response.data;
}

// ── Progress Helper ───────────────────────────────────────────────────────────

const PROGRESS = {
  QUEUED:          5,
  WAKING_AI:       10,
  FETCHING_BRAND:  20,
  CANONICAL_START: 30,
  PLATFORM_START:  50,
  BRAND_START:     70,
  HUMANIZE_START:  82,
  QA_START:        92,
  SAVING:          98,
  COMPLETE:        100,
} as const;

function emitProgress(
  orgId: string,
  requestId: string,
  progress: number,
  step: string,
  extra: Record<string, unknown> = {}
): void {
  try {
    emitToOrg(orgId, 'content:progress', { requestId, progress, step, ...extra });
    logger.debug('Progress emitted', { requestId, progress, step });
  } catch (err) {
    logger.warn('emitProgress failed', { requestId, err });
  }
}

// ── Main Job Processor ────────────────────────────────────────────────────────

async function processContentJob(job: Job<ContentJobData>): Promise<void> {
  const { requestId, organizationId } = job.data;
  const startTime = Date.now();
  const attempt = job.attemptsMade + 1;
  const maxAttempts = job.opts.attempts || 3;

  logger.info('🚀 Processing content job', {
    jobId: job.id,
    requestId,
    topic: job.data.topic?.slice(0, 60),
    attempt,
    maxAttempts,
  });

  await updateRequestStatus(requestId, 'running');
  emitProgress(organizationId, requestId, PROGRESS.QUEUED, 'initializing');

  try {
    // ── Step 1: Wake AI Engine ──────────────────────────────────
    emitProgress(organizationId, requestId, PROGRESS.WAKING_AI, 'waking_ai_engine');

    const isAwake = await wakeUpAIEngine();
    if (!isAwake) {
      throw new Error(
        'AI Engine did not respond after 3.5 minutes. Please try again in a moment.'
      );
    }

    // ── Step 2: Fetching context ────────────────────────────────
    emitProgress(organizationId, requestId, PROGRESS.FETCHING_BRAND, 'fetching_brand_context');
    await new Promise(r => setTimeout(r, 300)); // Small UI feedback delay

    // ── Step 3: Start pipeline ──────────────────────────────────
    emitProgress(organizationId, requestId, PROGRESS.CANONICAL_START, 'ai_generating');
    await logAgentExecution(requestId, 'canonical_writer', 'started');

    const pipelineStart = Date.now();

    // ✅ HONEST heartbeat — progress based on realistic pipeline timing
    // Real pipeline: canonical (15s) → platform (20s) → brand (15s) → humanize (25s) → qa (10s)
    const heartbeat = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - pipelineStart) / 1000);

      let progress: number;
      let step: string;

      if (elapsedSec < 15) {
        progress = 30 + Math.floor((elapsedSec / 15) * 15);  // 30→45
        step = 'writing_canonical_draft';
      } else if (elapsedSec < 35) {
        progress = 45 + Math.floor(((elapsedSec - 15) / 20) * 15);  // 45→60
        step = 'platform_optimization';
      } else if (elapsedSec < 50) {
        progress = 60 + Math.floor(((elapsedSec - 35) / 15) * 12);  // 60→72
        step = 'brand_alignment';
      } else if (elapsedSec < 75) {
        progress = 72 + Math.floor(((elapsedSec - 50) / 25) * 15);  // 72→87
        step = 'humanizing_content';
      } else if (elapsedSec < 90) {
        progress = 87 + Math.floor(((elapsedSec - 75) / 15) * 6);   // 87→93
        step = 'quality_assurance';
      } else {
        // Long-running: cap at 95%
        progress = Math.min(95, 93 + Math.floor((elapsedSec - 90) / 20));
        step = 'finalizing';
      }

      emitProgress(organizationId, requestId, progress, step, { elapsedSec });
    }, 3_000);

    let result: PipelineResponse;
    try {
      result = await callFullPipeline(job.data);
    } finally {
      clearInterval(heartbeat);
    }

    const pipelineDurationMs = Date.now() - pipelineStart;

    logger.info('✅ Pipeline completed', {
      requestId,
      totalTokens: result.totalTokensUsed,
      artifactCount: result.artifacts.length,
      durationMs: pipelineDurationMs,
    });

    await logAgentExecution(requestId, 'canonical_writer', 'completed', {
      tokensUsed: result.totalTokensUsed,
      durationMs: pipelineDurationMs,
    });

    // ── Step 4: Save Results ────────────────────────────────────
    emitProgress(organizationId, requestId, PROGRESS.SAVING, 'saving_results', {
      artifactCount: result.artifacts.length,
    });

    // Canonical draft save karo (sirf ek baar)
    await saveArtifact(requestId, 'canonical', 'canonical', result.canonicalDraft);

    // Platform artifacts save karo
    for (const artifact of result.artifacts) {
      await saveArtifact(
        requestId, artifact.platform, 'platform_adapted', artifact.platformVariant
      );
      await saveArtifact(
        requestId, artifact.platform, 'brand_aligned', artifact.brandAligned
      );

      // Humanized sirf tab save karo jab alag ho
      if (artifact.humanized && artifact.humanized !== artifact.brandAligned) {
        await saveArtifact(
          requestId, artifact.platform, 'humanized', artifact.humanized
        );
      }

      // QA reviewed - final content
      await saveArtifact(
        requestId, artifact.platform, 'qa_reviewed', artifact.finalContent,
        {
          qa: artifact.qa,
          overallScore: artifact.overallScore,
          passed: artifact.passed,
        }
      );
    }

    // Token count update karo
    await query(
      `UPDATE content_requests SET total_tokens_used = $1 WHERE id = $2`,
      [result.totalTokensUsed, requestId]
    );

    await updateRequestStatus(requestId, 'awaiting_review');

    // ── Step 5: Complete! ───────────────────────────────────────
    emitProgress(organizationId, requestId, PROGRESS.COMPLETE, 'completed', {
      artifactCount: result.artifacts.length,
      totalTokens: result.totalTokensUsed,
    });

    emitToOrg(organizationId, 'content:completed', {
      requestId,
      artifactCount: result.artifacts.length,
      totalTokens: result.totalTokensUsed,
    });

    // AI engine recently worked, mark it
    markAiEngineAwake();

    logger.info('🎉 Content job completed', {
      requestId,
      totalDurationMs: Date.now() - startTime,
      tokens: result.totalTokensUsed,
      artifacts: result.artifacts.length,
    });

  } catch (err) {
    // ── Error Handling ──────────────────────────────────────────
    const errorMsg = parseError(err);

    logger.error('❌ Content job failed', {
      requestId,
      jobId: job.id,
      attempt,
      error: errorMsg,
    });

    await logAgentExecution(requestId, 'canonical_writer', 'failed', {
      errorMessage: errorMsg,
      durationMs: Date.now() - startTime,
    });

    const isFinalAttempt = attempt >= maxAttempts;

    if (isFinalAttempt) {
      await updateRequestStatus(requestId, 'generation_failed', errorMsg);

      emitToOrg(organizationId, 'content:failed', {
        requestId,
        error: errorMsg,
        canRetry: false,
      });

      logger.warn('Job failed permanently', { requestId, jobId: job.id });
    } else {
      logger.info(`⏳ Will retry (${attempt}/${maxAttempts})`, { requestId });

      emitToOrg(organizationId, 'content:retrying', {
        requestId,
        attempt,
        maxAttempts,
        message: `Retrying... (${attempt + 1}/${maxAttempts})`,
      });
    }

    throw err; // BullMQ retry ke liye re-throw karo
  }
}

// ── Error Parser ──────────────────────────────────────────────────────────────

function parseError(err: unknown): string {
  if (err instanceof AxiosError) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return 'AI Engine request timed out - content generation took too long';
    }
    if (err.code === 'ECONNREFUSED') {
      return 'AI Engine is not running - service may be down';
    }
    if (err.response) {
      // ✅ Extract detail field from FastAPI error response
      const data = err.response.data;
      let detail: string;

      if (typeof data === 'object' && data !== null) {
        detail = (data as any).detail 
              || (data as any).error 
              || JSON.stringify(data).slice(0, 300);
      } else {
        detail = String(data).slice(0, 300);
      }

      return `AI Engine [${err.response.status}]: ${detail}`;
    }
    if (err.request) {
      return 'AI Engine unreachable - no response received';
    }
    return err.message;
  }

  if (err instanceof Error) {
    return err.message;
  }

  return 'Unknown error occurred';
}

// ── Start Worker ──────────────────────────────────────────────────────────────

export function startContentWorker(): void {
  const worker = new Worker<ContentJobData>(
    'content-generation',
    processContentJob,
    {
      connection: getRedisConnection(),
      concurrency: Number(process.env.WORKER_CONCURRENCY) || 2,
      limiter: {
        max: 5,
        duration: 60_000,
      },
    }
  );

  worker.on('completed', (job) => {
    logger.info('Worker: Job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    logger.error('Worker: Job failed', {
      jobId: job?.id,
      error: err.message,
      attempts: job?.attemptsMade,
    });
  });

  worker.on('error', (err) => {
    logger.error('Worker error', { error: err.message });
  });

  worker.on('active', (job) => {
    logger.info('Worker: Job started', {
      jobId: job.id,
      requestId: job.data.requestId,
    });
  });

  logger.info('✅ Content worker started', {
    concurrency: worker.opts.concurrency,
    aiEngineUrl: AI_ENGINE_URL,
    timeout: `${AI_TIMEOUT_MS}ms`,
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, closing worker gracefully...');
    await worker.close();
    logger.info('Worker closed');
  });
}
