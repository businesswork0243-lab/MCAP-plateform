// apps/api/src/jobs/workers/contentWorker.ts
import { Worker, Job } from 'bullmq';
import axios, { AxiosError } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/connection';
import { logger } from '../../lib/logger';
import { ContentJobData } from '../queue';
import { emitToOrg } from '../../services/websocket';

// ✅ Shared keepalive — duplicate code hata diya
import { waitForAiEngine, markAiEngineAlive } from '../../services/keepalive';

// ── Config ────────────────────────────────────────────────────────────────────

const AI_ENGINE_URL = (
  process.env.AI_ENGINE_URL || 'http://localhost:8000'
).replace(/\/$/, '');

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
       SET ${updates.join(', ')}, error_message = $2
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

  logger.debug('Artifact saved', { id, requestId, platform, contentType });
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
    topic: jobData.topic,
    objective: jobData.objective || 'Build thought leadership',
    context: jobData.context || '',
    audience: jobData.audience || 'General Business',
    icp_description: jobData.icp_description || '',
    perspective: jobData.perspective || 'Founder',
    writing_structure: jobData.writing_structure || 'thesis',
    cta: jobData.cta || '',
    targetPlatforms: jobData.targetPlatforms || ['linkedin_post'],
    brandProfile: jobData.brandProfile || null,
    enableHumanization: jobData.enableHumanization ?? true,
    humanizationIntensity: jobData.humanizationIntensity || 'medium',
    enableQA: jobData.enableQA ?? true,
    language: jobData.language || 'English',
    keywords: jobData.keywords || [],
    specialInstructions: jobData.specialInstructions || '',
    seoEnabled: jobData.seoEnabled ?? false,
    seoSettings: jobData.seoSettings || {},
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

// ── Progress ──────────────────────────────────────────────────────────────────

const PROGRESS = {
  QUEUED: 5,
  WAKING_AI: 10,
  FETCHING_BRAND: 20,
  CANONICAL_START: 30,
  SAVING: 98,
  COMPLETE: 100,
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
  } catch (err) {
    logger.warn('emitProgress failed', { requestId, err });
  }
}

// ── Brand Fetch ───────────────────────────────────────────────────────────────

async function fetchBrandWithDocuments(
  brandProfileId: string | null | undefined
): Promise<Record<string, unknown> | null> {
  if (!brandProfileId) return null;

  try {
    const rows = await query(
      'SELECT * FROM brand_profiles WHERE id = $1',
      [brandProfileId]
    );
    const brand = rows[0];
    if (!brand) return null;

    const docs = await query<{ name: string; parsed_content: string }>(
      `SELECT name, parsed_content
       FROM brand_documents
       WHERE brand_profile_id = $1
         AND parsing_status = 'done'
         AND parsed_content IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 5`,
      [brandProfileId]
    );

    const documentContext = docs.length > 0
      ? docs.map(d => `=== ${d.name} ===\n${d.parsed_content}`)
        .join('\n\n')
        .slice(0, 8000)
      : '';

    const parseJson = (val: unknown): unknown[] => {
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return []; }
      }
      return [];
    };

    logger.info('Brand fetched in worker', {
      brandId: brandProfileId,
      docCount: docs.length,
      contextChars: documentContext.length,
    });

    return {
      ...brand,
      tone_settings: {
        formality: brand.tone_formality ?? 5,
        technical: brand.tone_technical ?? 5,
        confidence: brand.tone_confidence ?? 5,
        emotion: brand.tone_emotion ?? 5,
        humor: brand.tone_humor ?? 2,
        storytelling: brand.tone_storytelling ?? 5,
        persuasiveness: brand.tone_persuasiveness ?? 5,
        assertiveness: brand.tone_assertiveness ?? 5,
        enthusiasm: brand.tone_enthusiasm ?? 5,
        empathy: brand.tone_empathy ?? 5,
      },
      preferred_terms: parseJson(brand.preferred_terms),
      banned_phrases: parseJson(brand.banned_phrases),
      key_messages: parseJson(brand.key_messages),
      likes: parseJson(brand.likes),
      hates: parseJson(brand.hates),
      stands_for: parseJson(brand.stands_for),
      stands_against: parseJson(brand.stands_against),
      core_values: parseJson(brand.core_values),
      core_motivations: parseJson(brand.core_motivations),
      document_context: documentContext,
      has_documents: docs.length > 0,
      document_count: docs.length,
    };
  } catch (err) {
    logger.error('Brand fetch failed', {
      brandProfileId,
      error: err instanceof Error ? err.message : err,
    });
    return null;
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
    // ── Step 1: AI Engine check ───────────────────────────────────────────
    emitProgress(organizationId, requestId, PROGRESS.WAKING_AI, 'waking_ai_engine');

    // ✅ Shared keepalive.ts ka function use karo — duplicate nahi
    const isAwake = await waitForAiEngine(3 * 60 * 1000); // 3 min max
    if (!isAwake) {
      throw new Error(
        'AI Engine did not respond after 3 minutes. Please try again.'
      );
    }

    // ── Step 2: Brand fetch ───────────────────────────────────────────────
    emitProgress(organizationId, requestId, PROGRESS.FETCHING_BRAND, 'fetching_brand_context');

    const freshBrandProfile = await fetchBrandWithDocuments(job.data.brandProfileId);

    if (freshBrandProfile) {
      logger.info('Fresh brand loaded', {
        requestId,
        brandName: freshBrandProfile.name,
        hasDocs: freshBrandProfile.has_documents,
        contextChars: (freshBrandProfile.document_context as string)?.length ?? 0,
      });
    }

    // ── Step 3: Pipeline ──────────────────────────────────────────────────
    emitProgress(organizationId, requestId, PROGRESS.CANONICAL_START, 'ai_generating');
    await logAgentExecution(requestId, 'canonical_writer', 'started');

    const pipelineStart = Date.now();

    // Heartbeat — realistic progress updates
    const heartbeat = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - pipelineStart) / 1000);
      let progress: number;
      let step: string;

      if (elapsedSec < 15) {
        progress = 30 + Math.floor((elapsedSec / 15) * 15);
        step = 'writing_canonical_draft';
      } else if (elapsedSec < 35) {
        progress = 45 + Math.floor(((elapsedSec - 15) / 20) * 15);
        step = 'platform_optimization';
      } else if (elapsedSec < 50) {
        progress = 60 + Math.floor(((elapsedSec - 35) / 15) * 12);
        step = 'brand_alignment';
      } else if (elapsedSec < 75) {
        progress = 72 + Math.floor(((elapsedSec - 50) / 25) * 15);
        step = 'humanizing_content';
      } else if (elapsedSec < 90) {
        progress = 87 + Math.floor(((elapsedSec - 75) / 15) * 6);
        step = 'quality_assurance';
      } else {
        progress = Math.min(95, 93 + Math.floor((elapsedSec - 90) / 20));
        step = 'finalizing';
      }

      emitProgress(organizationId, requestId, progress, step, { elapsedSec });
    }, 3_000);

    let result: PipelineResponse;
    try {
      result = await callFullPipeline({
        ...job.data,
        brandProfile: (freshBrandProfile || job.data.brandProfile) as any,
      });
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

    // ── Step 4: Save ──────────────────────────────────────────────────────
    emitProgress(organizationId, requestId, PROGRESS.SAVING, 'saving_results', {
      artifactCount: result.artifacts.length,
    });

    // Canonical
    await saveArtifact(requestId, 'canonical', 'canonical', result.canonicalDraft);

    // Platform artifacts
    for (const artifact of result.artifacts) {
      await saveArtifact(
        requestId, artifact.platform, 'platform_adapted', artifact.platformVariant
      );
      await saveArtifact(
        requestId, artifact.platform, 'brand_aligned', artifact.brandAligned
      );
      if (artifact.humanized && artifact.humanized !== artifact.brandAligned) {
        await saveArtifact(
          requestId, artifact.platform, 'humanized', artifact.humanized
        );
      }
      await saveArtifact(
        requestId, artifact.platform, 'qa_reviewed', artifact.finalContent,
        { qa: artifact.qa, overallScore: artifact.overallScore, passed: artifact.passed }
      );
    }

    await query(
      `UPDATE content_requests SET total_tokens_used = $1 WHERE id = $2`,
      [result.totalTokensUsed, requestId]
    );

    await updateRequestStatus(requestId, 'awaiting_review');

    // ── Step 5: Done ──────────────────────────────────────────────────────
    emitProgress(organizationId, requestId, PROGRESS.COMPLETE, 'completed', {
      artifactCount: result.artifacts.length,
      totalTokens: result.totalTokensUsed,
    });

    emitToOrg(organizationId, 'content:completed', {
      requestId,
      artifactCount: result.artifacts.length,
      totalTokens: result.totalTokensUsed,
    });

    // ✅ Shared state update karo
    markAiEngineAlive();

    logger.info('🎉 Job done', {
      requestId,
      totalDurationMs: Date.now() - startTime,
      tokens: result.totalTokensUsed,
      artifacts: result.artifacts.length,
    });

  } catch (err) {
    const errorMsg = parseError(err);
    const isFinalAttempt = attempt >= maxAttempts;

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

    if (isFinalAttempt) {
      await updateRequestStatus(requestId, 'generation_failed', errorMsg);
      emitToOrg(organizationId, 'content:failed', {
        requestId,
        error: errorMsg,
        canRetry: false,
      });
    } else {
      emitToOrg(organizationId, 'content:retrying', {
        requestId,
        attempt,
        maxAttempts,
        message: `Retrying... (${attempt + 1}/${maxAttempts})`,
      });
    }

    throw err;
  }
}

// ── Error Parser ──────────────────────────────────────────────────────────────

function parseError(err: unknown): string {
  if (err instanceof AxiosError) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return 'AI Engine timed out';
    }
    if (err.code === 'ECONNREFUSED') {
      return 'AI Engine is not running';
    }
    if (err.response) {
      const data = err.response.data;
      const detail = typeof data === 'object' && data !== null
        ? (data as any).detail || (data as any).error || JSON.stringify(data).slice(0, 300)
        : String(data).slice(0, 300);
      return `AI Engine [${err.response.status}]: ${detail}`;
    }
    if (err.request) return 'AI Engine unreachable';
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Unknown error';
}

// ── Start Worker ──────────────────────────────────────────────────────────────

export function startContentWorker(): void {
  const worker = new Worker<ContentJobData>(
    'content-generation',
    processContentJob,
    {
      connection: getRedisConnection(),
      concurrency: Number(process.env.WORKER_CONCURRENCY) || 2,
      limiter: { max: 5, duration: 60_000 },
    }
  );

  worker.on('completed', (job) =>
    logger.info('Worker: Job completed', { jobId: job.id })
  );
  worker.on('failed', (job, err) =>
    logger.error('Worker: Job failed', {
      jobId: job?.id,
      error: err.message,
      attempts: job?.attemptsMade,
    })
  );
  worker.on('error', (err) =>
    logger.error('Worker error', { error: err.message })
  );
  worker.on('active', (job) =>
    logger.info('Worker: Job started', {
      jobId: job.id,
      requestId: job.data.requestId,
    })
  );

  logger.info('✅ Content worker started', {
    concurrency: worker.opts.concurrency,
    aiEngineUrl: AI_ENGINE_URL,
    timeout: `${AI_TIMEOUT_MS}ms`,
  });

  process.on('SIGTERM', async () => {
    logger.info('SIGTERM — closing worker...');
    await worker.close();
    logger.info('Worker closed');
  });
}