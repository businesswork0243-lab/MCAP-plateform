// apps/api/src/routes/content.ts
import { Router, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import axios from 'axios'
import { query, queryOne, withTransaction } from '../db/connection'
import { AuthenticatedRequest, authenticate } from '../middleware/auth'
import { addContentJob } from '../jobs/queue'
import { logger } from '../lib/logger'
import { bulkRouter } from './bulk'

export const contentRouter = Router()
contentRouter.use(authenticate)
contentRouter.use('/bulk', bulkRouter)
export default contentRouter

// ─── Schemas ──────────────────────────────────────────────────────────────────

const tonalitySchema = z.object({
  angry:      z.number().min(0).max(10).default(0),
  frustrated: z.number().min(0).max(10).default(0),
  excited:    z.number().min(0).max(10).default(5),
  confident:  z.number().min(0).max(10).default(6),
  curious:    z.number().min(0).max(10).default(4),
  empathetic: z.number().min(0).max(10).default(5),
  playful:    z.number().min(0).max(10).default(3),
  serious:    z.number().min(0).max(10).default(5),
}).default({})

const seoSettingsSchema = z.object({
  primaryKeyword:     z.string().optional(),
  secondaryKeywords:  z.array(z.string()).default([]),
  metaDescription:    z.string().max(160).optional(),
  targetWordCount:    z.number().optional(),
}).default({})

const createRequestSchema = z.object({
  // Core — REQUIRED
  topic:     z.string().min(3).max(500),

  // Optional with defaults
  objective:           z.string().optional().default('Build thought leadership'),
  context:             z.string().optional().default(''),

  // Audience
  audience:            z.string().optional().default('General Business'),
  audienceDescription: z.string().optional(),
  icpProfileId:        z.string().uuid().optional(),

  // Platforms — REQUIRED, min 1
  platforms: z.array(z.string().min(1)).min(1, 'Select at least one platform'),

  // Blog word count
  wordCount: z.number().min(100).max(5000).optional(),

  // Structure
  writingStructure:     z.string().optional().default('thesis'),
  customStructureId:    z.string().uuid().optional(),
  customStructureFlow:  z.string().optional(),

  // Style
  narrativePerspective: z.string().optional().default('Founder'),
  language:             z.string().optional().default('English'),
  keywords:             z.array(z.string()).optional().default([]),

  // CTA
  ctaType:   z.string().optional(),
  customCta: z.string().optional(),

  // Brand & Tone
  brandProfileId:   z.string().uuid().optional(),
  toneOverrides:    z.record(z.number()).optional(),
  tonalitySpectrum: z.record(z.number()).optional().default({}),

  // AI Settings
  humanizationEnabled:  z.boolean().optional().default(true),
  humanizationLevel:    z.enum(['light', 'medium', 'aggressive']).optional().default('medium'),
  qaEnabled:            z.boolean().optional().default(true),
  requiresApproval:     z.boolean().optional().default(false),

  // SEO
  seoEnabled:  z.boolean().optional().default(false),
  seoSettings: z.record(z.unknown()).optional().default({}),

  // Special instructions
  specialInstructions: z.string().optional(),

  // References
  referenceUrls: z.array(z.string()).optional().default([]),
  readingLevel:  z.string().optional(),

  // Org
  projectId: z.string().uuid().optional(),
  clientId:  z.string().uuid().optional(),
})

const repurposeSchema = z.object({
  targetPlatform:   z.string().min(1),
  sourceArtifactId: z.string().uuid().optional(),
})

// ─── Helper: Build AI Engine Payload ─────────────────────────────────────────

async function buildAIPayload(
  data: z.infer<typeof createRequestSchema>,
  orgId: string
): Promise<Record<string, unknown>> {
  // Fetch ICP data if selected
  let icpData: Record<string, unknown> | null = null
  if (data.icpProfileId) {
    const icp = await queryOne(
      'SELECT * FROM icp_profiles WHERE id = $1 AND organization_id = $2',
      [data.icpProfileId, orgId]
    )
    if (icp) icpData = icp as Record<string, unknown>
  }

  // Fetch brand profile if selected
  let brandData: Record<string, unknown> | null = null
  if (data.brandProfileId) {
    const brand = await queryOne(
      `SELECT bp.*,
        (SELECT parsed_content FROM brand_documents 
         WHERE brand_profile_id = bp.id AND parsing_status = 'done'
         LIMIT 3) as doc_context
       FROM brand_profiles bp
       WHERE bp.id = $1 AND bp.organization_id = $2`,
      [data.brandProfileId, orgId]
    )
    if (brand) brandData = brand as Record<string, unknown>
  }

  // Fetch custom writing structure
  let structureFlow: string[] | null = null
  if (data.customStructureId) {
    const structure = await queryOne<{ structure_flow: string[] }>(
      'SELECT structure_flow FROM writing_structures WHERE id = $1',
      [data.customStructureId]
    )
    if (structure) structureFlow = structure.structure_flow
  }

  // Build audience string from ICP or manual
  const audienceStr = icpData
    ? `${(icpData.basic_characteristics as Record<string, string>)?.role || ''} in ${(icpData.basic_characteristics as Record<string, string>)?.industry || ''}`
    : data.audience || 'General Business'

  const icpDescription = icpData
    ? `Challenges: ${JSON.stringify(icpData.current_challenges)}. Goals: ${JSON.stringify(icpData.goals)}. Frustrations: ${JSON.stringify(icpData.frustrations)}.`
    : data.audienceDescription || ''

  return {
    topic:               data.topic,
    objective:           data.objective || 'Build thought leadership',
    context:             data.context || '',
    audience:            audienceStr,
    icp_description:     icpDescription,
    perspective:         data.narrativePerspective || 'Founder',
    writing_structure:   data.writingStructure || 'thesis',
    custom_structure_flow: structureFlow || 
      (data.customStructureFlow ? data.customStructureFlow.split('\n').filter(Boolean) : null),
    cta:                 data.ctaType === 'custom' ? data.customCta : data.ctaType || '',
    targetPlatforms:     data.platforms,
    language:            data.language,
    keywords:            data.keywords,
    specialInstructions: buildSpecialInstructions(data),
    enableHumanization:  data.humanizationEnabled,
    humanizationIntensity: data.humanizationLevel,
    enableQA:            data.qaEnabled,
    brandProfile:        brandData,
    tonalitySpectrum:    data.tonalitySpectrum,
    wordCount:           data.wordCount,
    seoEnabled:          data.seoEnabled,
    seoSettings:         data.seoSettings,
  }
}

function buildSpecialInstructions(data: z.infer<typeof createRequestSchema>): string {
  const parts: string[] = []

  // Add tonality instructions
  const highTones = Object.entries(data.tonalitySpectrum || {})
    .filter(([, v]) => v >= 6)
    .sort(([, a], [, b]) => b - a)
    .map(([k, v]) => `${k} (${v}/10)`)

  if (highTones.length > 0) {
    parts.push(`Tonality for this piece: ${highTones.join(', ')}.`)
  }

  // Add word count instruction
  if (data.wordCount) {
    parts.push(`Target word count: approximately ${data.wordCount} words.`)
  }

  // Add SEO instructions
  if (data.seoEnabled && data.seoSettings.primaryKeyword) {
    parts.push(
      `SEO optimize for "${data.seoSettings.primaryKeyword}". ` +
      `Include H2/H3 headings, meta-friendly structure.`
    )
  }

  // User's own instructions
  if (data.specialInstructions) {
    parts.push(data.specialInstructions)
  }

  return parts.join(' ')
}

// ─── CONTENT ROUTES ───────────────────────────────────────────────────────────

// GET /api/content - FIXED
contentRouter.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { page = '1', limit = '20', status, clientId } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const filterParams: unknown[] = [req.user!.organizationId];
    let whereClause = `WHERE cr.organization_id = $1`;

    if (status) {
      filterParams.push(status);
      whereClause += ` AND cr.status = $${filterParams.length}`;
    }

    if (clientId) {
      filterParams.push(clientId);
      whereClause += ` AND cr.client_id = $${filterParams.length}`;
    }

    const requests = await query(
      `SELECT 
         cr.id,
         cr.topic,
         COALESCE(cr.status, 'draft') as status,
         COALESCE(cr.platforms, '[]'::jsonb) as platforms,
         cr.target_platform,
         COALESCE(cr.language, 'English') as language,
         cr.created_at,
         cr.updated_at,
         cr.error_message,
         cr.total_tokens_used,
         u.name as created_by_name,
         c.name as client_name,
         bp.name as brand_profile_name
       FROM content_requests cr
       LEFT JOIN users u ON u.id = cr.created_by
       LEFT JOIN clients c ON c.id = cr.client_id
       LEFT JOIN brand_profiles bp ON bp.id = cr.brand_profile_id
       ${whereClause}
       ORDER BY cr.created_at DESC
       LIMIT $${filterParams.length + 1}
       OFFSET $${filterParams.length + 2}`,
      [...filterParams, limitNum, offset]
    );

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM content_requests cr
       ${whereClause}`,
      filterParams
    );

    res.json({
      requests,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: parseInt(countResult?.count || '0', 10),
      },
    });
  } catch (err) {
    logger.error('GET /content error:', { error: err });
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});

// POST /api/content/generate
contentRouter.post('/generate', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parsed = createRequestSchema.safeParse(req.body)

    if (!parsed.success) {
      // Readable error format
      const errors = parsed.error.errors.map(e => ({
        field:   e.path.join('.'),
        message: e.message,
        received: e.code === 'too_small' ? `Got ${(e as unknown as {received: number}).received}` : undefined,
      }));

      logger.warn('Content generate validation failed', {
        errors,
        body: {
          topic:     req.body.topic,
          platforms: req.body.platforms,
        },
      });

      res.status(400).json({
        error:   'Validation failed',
        details: errors,
        hint:    'Check platforms (array required) and topic (min 3 chars)',
      });
      return;
    }

    const data = parsed.data
    const id = uuidv4()

    // Build AI payload (resolves ICP, brand, structure)
    const aiPayload = await buildAIPayload(data, req.user!.organizationId)

    // Save request to DB
    await query(
      `INSERT INTO content_requests (
        id, project_id, organization_id, created_by, client_id,
        topic, objective, context, audience, audience_description,
        platforms, target_platform,
        writing_structure, custom_structure_id, custom_structure_flow,
        narrative_perspective, cta_type, custom_cta,
        brand_profile_id, icp_profile_id,
        tone_overrides, tonality_spectrum,
        humanization_enabled, humanization_level,
        qa_enabled, requires_approval,
        reading_level, language, special_instructions,
        reference_urls, keywords,
        word_count, seo_enabled, seo_settings,
        status
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,$9,$10,
        $11,$12,
        $13,$14,$15,
        $16,$17,$18,
        $19,$20,
        $21,$22,
        $23,$24,
        $25,$26,
        $27,$28,$29,
        $30,$31,
        $32,$33,$34,
        'queued'
      )`,
      [
        id,
        data.projectId ?? null,
        req.user!.organizationId,
        req.user!.id,
        data.clientId ?? null,

        data.topic.slice(0, 500),
        (data.objective ?? '').slice(0, 500) || null,
        data.context ?? null,
        (aiPayload.audience as string).slice(0, 500),  // ✅ Guard
        data.audienceDescription ?? null,

        JSON.stringify(data.platforms),
        data.platforms[0].slice(0, 200),  // ✅ Guard

        (data.writingStructure ?? '').slice(0, 500) || null,  // ✅ Guard
        data.customStructureId ?? null,
        data.customStructureFlow ?? null,

        (data.narrativePerspective ?? '').slice(0, 500) || null,  // ✅ Guard
        (data.ctaType ?? '').slice(0, 500) || null,  // ✅ Guard
        data.customCta ?? null,

        data.brandProfileId ?? null,
        data.icpProfileId ?? null,

        data.toneOverrides ? JSON.stringify(data.toneOverrides) : null,
        JSON.stringify(data.tonalitySpectrum),

        data.humanizationEnabled,
        (data.humanizationLevel ?? 'medium').slice(0, 50),  // ✅ Guard

        data.qaEnabled,
        data.requiresApproval,

        (data.readingLevel ?? '').slice(0, 100) || null,  // ✅ Guard
        (data.language ?? 'English').slice(0, 50),  // ✅ Guard
        data.specialInstructions ?? null,

        JSON.stringify(data.referenceUrls),
        JSON.stringify(data.keywords),

        data.wordCount ?? null,
        data.seoEnabled,
        JSON.stringify(data.seoSettings),
      ]
    )

    // Increment writing structure use count
    if (data.customStructureId) {
      await query(
        'UPDATE writing_structures SET use_count = use_count + 1 WHERE id = $1',
        [data.customStructureId]
      )
    }

    // Queue the AI job
    await addContentJob(id, {
      ...aiPayload,
      targetPlatform: data.platforms[0],
      brandProfileId: data.brandProfileId || '',
      organizationId: req.user!.organizationId,
      createdBy: req.user!.id,
    } as any)

    logger.info('Content generation queued', {
      requestId: id,
      topic: data.topic.slice(0, 50),
      platforms: data.platforms,
      userId: req.user!.id,
    })

    res.status(202).json({
      requestId: id,
      contentId: id,  // Alias for frontend
      status: 'queued',
      message: 'Generation started',
    })
  } catch (err) {
    logger.error('POST /content/generate error:', { error: err })
    res.status(500).json({ error: 'Failed to queue generation' })
  }
})

// GET /api/content/jobs/:id
contentRouter.get('/jobs/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const request = await queryOne(
      `SELECT cr.*, bp.name as brand_profile_name
       FROM content_requests cr
       LEFT JOIN brand_profiles bp ON bp.id = cr.brand_profile_id
       WHERE cr.id = $1 AND cr.organization_id = $2`,
      [req.params.id, req.user!.organizationId]
    )
    if (!request) { res.status(404).json({ error: 'Not found' }); return }

    const executions = await query(
      `SELECT 
     agent_name, 
     status, 
     tokens_used, 
     duration_ms, 
     error_message, 
     created_at
   FROM agent_executions
   WHERE COALESCE(request_id, content_request_id) = $1
   ORDER BY created_at ASC`,
      [req.params.id]
    )

    res.json({ request, executions })
  } catch (err) {
    logger.error('GET /content/jobs/:id error:', { error: err })
    res.status(500).json({ error: 'Failed to fetch job status' })
  }
})

// ─── GET /api/content/:id (Single content with artifacts) ─────────────────────

// GET /api/content/:id (FIXED - proper artifact structure)
contentRouter.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(req.params.id)) {
      res.status(400).json({ error: 'Invalid content ID format' });
      return;
    }

    // Fetch request
    const request = await queryOne(
      `SELECT cr.*,
        u.name as created_by_name,
        bp.name as brand_profile_name
       FROM content_requests cr
       LEFT JOIN users u ON u.id = cr.created_by
       LEFT JOIN brand_profiles bp ON bp.id = cr.brand_profile_id
       WHERE cr.id = $1 AND cr.organization_id = $2`,
      [req.params.id, req.user!.organizationId]
    );

    if (!request) {
      res.status(404).json({ error: 'Content not found' });
      return;
    }

    // Fetch artifacts with FULL metadata
    const artifacts = await query(
      `SELECT 
         a.id,
         a.content_request_id as request_id,
         a.agent_type as content_type,
         a.agent_type,
         COALESCE(a.edited_content, a.content) as body,
         COALESCE(a.edited_content, a.content) as content,
         a.content as original_content,
         a.edited_content,
         a.last_edited_at,
         a.refinement_count,
         a.version,
         a.status,
         a.quality_score,
         a.approved_by,
         a.approved_at,
         a.rejection_note,
         a.metadata,
         a.seo_meta,
         a.is_repurposed,
         a.created_at
       FROM artifacts a
       WHERE a.content_request_id = $1
       ORDER BY a.created_at ASC`,
      [req.params.id]
    );

    // Parse metadata JSON in each artifact
    const parsedArtifacts = artifacts.map((a: any) => {
      let parsedMetadata = a.metadata;
      if (typeof parsedMetadata === 'string') {
        try {
          parsedMetadata = JSON.parse(parsedMetadata);
        } catch {
          parsedMetadata = {};
        }
      }
      return {
        ...a,
        metadata: parsedMetadata,
      };
    });

    // Fetch executions
    let executions: Record<string, unknown>[] = [];
    try {
      executions = await query(
        `SELECT 
           COALESCE(agent_name, agent_type, 'unknown') as agent_name,
           COALESCE(status, 'completed') as status,
           tokens_used,
           duration_ms,
           error_message,
           created_at
         FROM agent_executions
         WHERE COALESCE(request_id, content_request_id) = $1
         ORDER BY created_at ASC`,
        [req.params.id]
      );
    } catch (execErr) {
      logger.warn('Failed to fetch executions', { error: execErr });
    }

    res.json({
      request,
      artifacts: parsedArtifacts,
      executions,
      meta: {
        isComplete: ['completed', 'approved', 'awaiting_review'].includes(request.status as string),
        isFailed:   ['failed', 'generation_failed'].includes(request.status as string),
        isProcessing: ['queued', 'running', 'processing'].includes(request.status as string),
        totalArtifacts: parsedArtifacts.length,
      },
    });
  } catch (err) {
    logger.error('GET /content/:id error:', { error: err });
    res.status(500).json({ error: 'Failed to fetch content' });
  }
});


// ─── POST /api/content/:id/rerun ──────────────────────────────────────────────

contentRouter.post('/:id/rerun', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    // Fetch original request
    const original = await queryOne<{
      id: string;
      topic: string;
      objective: string;
      context: string;
      audience: string;
      audience_description: string;
      platforms: string[] | string;
      writing_structure: string;
      narrative_perspective: string;
      cta_type: string;
      custom_cta: string;
      brand_profile_id: string;
      icp_profile_id: string;
      tonality_spectrum: Record<string, number>;
      humanization_enabled: boolean;
      humanization_level: string;
      qa_enabled: boolean;
      language: string;
      keywords: string[] | string;
      special_instructions: string;
      word_count: number;
      seo_enabled: boolean;
      seo_settings: Record<string, unknown>;
      client_id: string;
      project_id: string;
    }>(
      `SELECT * FROM content_requests 
       WHERE id = $1 AND organization_id = $2`,
      [req.params.id, req.user!.organizationId]
    );

    if (!original) {
      res.status(404).json({ error: 'Original content not found' });
      return;
    }

    // Parse JSONB fields safely
    const platforms = typeof original.platforms === 'string' 
      ? JSON.parse(original.platforms) 
      : original.platforms || ['linkedin_post'];
    
    const keywords = typeof original.keywords === 'string'
      ? JSON.parse(original.keywords)
      : original.keywords || [];

    const tonalitySpectrum = typeof original.tonality_spectrum === 'string'
      ? JSON.parse(original.tonality_spectrum)
      : original.tonality_spectrum || {};

    const seoSettings = typeof original.seo_settings === 'string'
      ? JSON.parse(original.seo_settings)
      : original.seo_settings || {};

    // Create new request
    const newId = uuidv4();

    await query(
      `INSERT INTO content_requests (
        id, project_id, organization_id, created_by, client_id,
        topic, objective, context, audience, audience_description,
        platforms, target_platform,
        writing_structure, narrative_perspective, 
        cta_type, custom_cta,
        brand_profile_id, icp_profile_id,
        tonality_spectrum,
        humanization_enabled, humanization_level,
        qa_enabled, language, special_instructions,
        keywords, word_count,
        seo_enabled, seo_settings,
        status
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12,
        $13, $14,
        $15, $16,
        $17, $18,
        $19,
        $20, $21,
        $22, $23, $24,
        $25, $26,
        $27, $28,
        'queued'
      )`,
      [
        newId,
        original.project_id,
        req.user!.organizationId,
        req.user!.id,
        original.client_id,
        original.topic,
        original.objective,
        original.context,
        original.audience,
        original.audience_description,
        JSON.stringify(platforms),
        platforms[0],
        original.writing_structure,
        original.narrative_perspective,
        original.cta_type,
        original.custom_cta,
        original.brand_profile_id,
        original.icp_profile_id,
        JSON.stringify(tonalitySpectrum),
        original.humanization_enabled,
        original.humanization_level,
        original.qa_enabled,
        original.language,
        original.special_instructions,
        JSON.stringify(keywords),
        original.word_count,
        original.seo_enabled,
        JSON.stringify(seoSettings),
      ]
    );

    // Queue AI job
    await addContentJob(newId, {
      topic: original.topic,
      objective: original.objective || 'Build thought leadership',
      context: original.context || '',
      audience: original.audience || 'General Business',
      icp_description: '',
      perspective: original.narrative_perspective || 'Founder',
      writing_structure: original.writing_structure || 'thesis',
      custom_structure_flow: null,
      cta: original.custom_cta || original.cta_type || '',
      targetPlatforms: platforms,
      targetPlatform: platforms[0],
      language: original.language || 'English',
      keywords,
      specialInstructions: original.special_instructions || '',
      enableHumanization: original.humanization_enabled ?? true,
      humanizationIntensity: (original.humanization_level as 'light' | 'medium' | 'aggressive') || 'medium',
      enableQA: original.qa_enabled ?? true,
      brandProfileId: original.brand_profile_id || '',
      brandProfile: null,
      tonalitySpectrum,
      wordCount: original.word_count,
      seoEnabled: original.seo_enabled ?? false,
      seoSettings,
      organizationId: req.user!.organizationId,
      createdBy: req.user!.id,
    } as any);

    logger.info('Content rerun queued', {
      originalId: req.params.id,
      newId,
      topic: original.topic.slice(0, 50),
    });

    res.status(202).json({
      requestId: newId,
      contentId: newId,
      status: 'queued',
      message: 'Rerun started',
      originalId: req.params.id,
    });
  } catch (err) {
    logger.error('POST /content/:id/rerun error:', { error: err });
    res.status(500).json({ error: 'Failed to rerun content' });
  }
});


// ─── POST /api/content/:id/rehumanize ─────────────────────────────────────────

contentRouter.post('/:id/rehumanize', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const request = await queryOne(
      'SELECT * FROM content_requests WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.organizationId]
    );

    if (!request) {
      res.status(404).json({ error: 'Content not found' });
      return;
    }

    // Get latest artifact
    const artifact = await queryOne<{ content: string; agent_type: string; metadata: any }>(
      `SELECT content, agent_type, metadata FROM artifacts
       WHERE content_request_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [req.params.id]
    );

    if (!artifact) {
      res.status(400).json({ error: 'No content to humanize' });
      return;
    }

    // Call AI Engine humanizer
    const aiUrl = process.env.AI_ENGINE_URL || 'http://localhost:8000';
    const response = await axios.post(
      `${aiUrl}/agents/humanizer`,
      {
        content: artifact.content,
        intensity: req.body.intensity || 'medium',
      },
      { timeout: 60_000 }
    );

    // Determine platform
    let platform = 'canonical';
    if (artifact.metadata) {
      try {
        const meta = typeof artifact.metadata === 'string'
          ? JSON.parse(artifact.metadata)
          : artifact.metadata;
        if (meta?.platform) platform = meta.platform;
      } catch {}
    }

    // Save new artifact
    const newArtifactId = uuidv4();
    const newMetadata = {
      platform,
      contentType: 'humanized',
    };
    await query(
      `INSERT INTO artifacts
        (id, content_request_id, agent_type, content, status, metadata, version)
       VALUES ($1, $2, 'humanized', $3, 'generated', $4, 1)`,
      [newArtifactId, req.params.id, response.data.content, JSON.stringify(newMetadata)]
    );

    res.json({
      artifactId: newArtifactId,
      content: response.data.content,
      tokensUsed: response.data.tokensUsed || 0,
    });
  } catch (err) {
    logger.error('POST /rehumanize error:', { error: err });
    res.status(500).json({ error: 'Failed to rehumanize' });
  }
});

// PATCH /api/content/:id/status
contentRouter.patch('/:id/status', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { action } = req.body
    if (action !== 'approve' && action !== 'reject') {
      res.status(400).json({ error: 'Invalid action. Must be approve or reject.' })
      return
    }

    const request = await queryOne(
      'SELECT id FROM content_requests WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.organizationId]
    )
    if (!request) {
      res.status(404).json({ error: 'Content not found' })
      return
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected'
    
    // Also approve or reject the latest artifact if one exists
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE content_requests
         SET status = $1, updated_at = NOW(),
             completed_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE completed_at END
         WHERE id = $2`,
        [newStatus, req.params.id]
      )

      // Find the latest active artifact to approve/reject
      const latestArtifact = await client.query(
        `SELECT id FROM artifacts 
         WHERE content_request_id = $1 
         ORDER BY created_at DESC LIMIT 1`,
        [req.params.id]
      )

      if (latestArtifact.rows[0]) {
        await client.query(
          `UPDATE artifacts
           SET status = $1, 
               approved_by = CASE WHEN $2 = 'approve' THEN $3::uuid ELSE approved_by END,
               approved_at = CASE WHEN $2 = 'approve' THEN NOW() ELSE approved_at END
           WHERE id = $4`,
          [
            newStatus, 
            action, 
            req.user!.id, 
            latestArtifact.rows[0].id
          ]
        )
      }
    })

    res.json({ message: `Content ${newStatus}` })
  } catch (err) {
    logger.error('PATCH /content/:id/status error:', { error: err })
    res.status(500).json({ error: 'Failed to update content status' })
  }
})


// GET /api/content/:id/artifacts
contentRouter.get('/:id/artifacts', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const request = await queryOne(
      'SELECT id FROM content_requests WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.organizationId]
    )
    if (!request) { res.status(404).json({ error: 'Not found' }); return }

    // ✅ FIXED: Use actual column names
    const artifacts = await query(
      `SELECT 
         a.id,
         a.content_request_id as request_id,
         a.agent_type as content_type,
         a.content as body,
         a.version,
         a.status,
         a.quality_score,
         a.approved_by,
         a.approved_at,
         a.created_at,
         a.metadata,
         a.seo_meta,
         a.is_repurposed
       FROM artifacts a
       WHERE a.content_request_id = $1
       ORDER BY a.created_at ASC`,
      [req.params.id]
    )

    res.json({ artifacts })
  } catch (err) {
    logger.error('GET /content/:id/artifacts error:', { error: err })
    res.status(500).json({ error: 'Failed to fetch artifacts' })
  }
})

// POST /api/content/:id/repurpose
contentRouter.post('/:id/repurpose', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parsed = repurposeSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors })
      return
    }

    const { targetPlatform, sourceArtifactId } = parsed.data

    // Verify request belongs to org
    const request = await queryOne(
      'SELECT * FROM content_requests WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.organizationId]
    )
    if (!request) { res.status(404).json({ error: 'Content not found' }); return }

    // Get source artifact content - FIXED
    let sourceContent = ''
    if (sourceArtifactId) {
      const artifact = await queryOne<{ content: string }>(
        'SELECT content FROM artifacts WHERE id = $1 AND content_request_id = $2',
        [sourceArtifactId, req.params.id]
      )
      sourceContent = artifact?.content || ''
    } else {
      // Use best available artifact
      const artifact = await queryOne<{ content: string }>(
        `SELECT content FROM artifacts
         WHERE content_request_id = $1
         ORDER BY
           CASE agent_type
             WHEN 'qa_reviewed' THEN 1
             WHEN 'humanized' THEN 2
             WHEN 'brand_aligned' THEN 3
             ELSE 4
           END
         LIMIT 1`,
        [req.params.id]
      )
      sourceContent = artifact?.content || ''
    }

    if (!sourceContent) {
      res.status(400).json({ error: 'No source content found to repurpose' })
      return
    }

    // Create repurpose record
    const repurposeId = uuidv4()
    await query(
      `INSERT INTO content_repurposes
        (id, organization_id, source_request_id, source_artifact_id, created_by, target_platform, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'generating')`,
      [
        repurposeId,
        req.user!.organizationId,
        req.params.id,
        sourceArtifactId ?? null,
        req.user!.id,
        targetPlatform,
      ]
    )

    // Call AI Engine
    try {
      const aiUrl = process.env.AI_ENGINE_URL || 'http://localhost:8000'
      const aiResponse = await axios.post(
        `${aiUrl}/agents/platform-optimizer`,
        {
          canonicalDraft: sourceContent,
          targetPlatform,
        },
        { timeout: 60_000 }
      )

      const repurposedContent = aiResponse.data?.content || ''
      const tokensUsed = aiResponse.data?.tokensUsed || 0

      // Save artifact
      const artifactId = uuidv4()
      await withTransaction(async (client) => {
        // Update repurpose record
        await client.query(
          `UPDATE content_repurposes
           SET status = 'done', repurposed_content = $1, tokens_used = $2, updated_at = NOW()
           WHERE id = $3`,
          [repurposedContent, tokensUsed, repurposeId]
        )

        // Save as artifact too
        await client.query(
          `INSERT INTO artifacts
            (id, content_request_id, agent_type, content, status, is_repurposed, repurpose_id, metadata)
           VALUES ($1, $2, 'platform_adapted', $3, 'generated', true, $4, $5)`,
          [
            artifactId, 
            req.params.id, 
            repurposedContent, 
            repurposeId,
            JSON.stringify({ platform: targetPlatform })
          ]
        )
      })

      logger.info('Repurpose done', {
        repurposeId,
        targetPlatform,
        tokensUsed,
      })

      res.json({
        repurposeId,
        artifactId,
        content: repurposedContent,
        targetPlatform,
        tokensUsed,
      })
    } catch (aiError) {
      // Mark repurpose as failed
      await query(
        `UPDATE content_repurposes
         SET status = 'failed', error_message = $1, updated_at = NOW()
         WHERE id = $2`,
        [
          aiError instanceof Error ? aiError.message : 'AI Engine error',
          repurposeId,
        ]
      )
      throw aiError
    }
  } catch (err) {
    logger.error('POST /content/:id/repurpose error:', { error: err })
    res.status(500).json({ error: 'Failed to repurpose content' })
  }
})

// GET /api/content/:id/repurposes
contentRouter.get('/:id/repurposes', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const repurposes = await query(
      `SELECT r.*, u.name as created_by_name
       FROM content_repurposes r
       JOIN users u ON u.id = r.created_by
       WHERE r.source_request_id = $1 AND r.organization_id = $2
       ORDER BY r.created_at DESC`,
      [req.params.id, req.user!.organizationId]
    )
    res.json({ repurposes })
  } catch (err) {
    logger.error('GET /content/:id/repurposes error:', { error: err })
    res.status(500).json({ error: 'Failed to fetch repurposes' })
  }
})

// POST /api/content/:requestId/artifacts/:artifactId/approve
contentRouter.post(
  '/:requestId/artifacts/:artifactId/approve',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      await query(
        `UPDATE artifacts
         SET status = 'approved', approved_by = $1, approved_at = NOW()
         WHERE id = $2 AND content_request_id = $3`,  // ✅ FIXED
        [req.user!.id, req.params.artifactId, req.params.requestId]
      )
      res.json({ message: 'Artifact approved' })
    } catch (err) {
      logger.error('POST approve error:', { error: err })
      res.status(500).json({ error: 'Failed to approve' })
    }
  }
)

// ═══════════════════════════════════════════════════════════════════════════
// EDIT / REFINE / REJECT / HISTORY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

const editSchema = z.object({
  content: z.string().min(1),
  changeSummary: z.string().optional(),
});

const refineSchema = z.object({
  userPrompt: z.string().optional().default(''),
  quickTags: z.array(z.string()).optional().default([]),
  preserveLength: z.boolean().optional().default(false),
});

const rejectSchema = z.object({
  reason: z.string().min(3),
  note: z.string().optional(),
});

// Helper for building refinement summary
function buildRefineSummary(userPrompt: string, quickTags: string[]): string {
  const parts: string[] = [];
  if (quickTags.length > 0) {
    parts.push(`Applied: ${quickTags.join(', ')}`);
  }
  if (userPrompt) {
    parts.push(userPrompt.slice(0, 100));
  }
  return parts.join(' | ') || 'AI refinement';
}

// ─── PATCH /api/content/:id/artifacts/:artifactId (Edit) ────────────────────

contentRouter.patch(
  '/:id/artifacts/:artifactId',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const parsed = editSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
        return;
      }

      const { content, changeSummary } = parsed.data;

      // Verify ownership
      const artifact = await queryOne<{
        id: string;
        content: string;
        content_request_id: string;
        metadata: any;
      }>(
        `SELECT a.id, a.content, a.content_request_id, a.metadata
         FROM artifacts a
         JOIN content_requests cr ON cr.id = a.content_request_id
         WHERE a.id = $1 AND cr.organization_id = $2`,
        [req.params.artifactId, req.user!.organizationId]
      );

      if (!artifact) {
        res.status(404).json({ error: 'Artifact not found' });
        return;
      }

      // Get platform from metadata
      let platform = 'canonical';
      try {
        const meta = typeof artifact.metadata === 'string' 
          ? JSON.parse(artifact.metadata) 
          : artifact.metadata;
        platform = meta?.platform || platform;
      } catch {}

      // Get next version number
      const versionResult = await queryOne<{ next_version: number }>(
        `SELECT COALESCE(MAX(version_number), 0) + 1 as next_version
         FROM content_versions
         WHERE artifact_id = $1`,
        [artifact.id]
      );
      const nextVersion = versionResult?.next_version || 1;

      // Get previous version ID
      const prevVersion = await queryOne<{ id: string }>(
        `SELECT id FROM content_versions
         WHERE artifact_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [artifact.id]
      );

      // Save version + update artifact
      const versionId = uuidv4();
      await withTransaction(async (client) => {
        // Create version record
        await client.query(
          `INSERT INTO content_versions (
            id, content_request_id, artifact_id, version_number,
            platform, content, change_type, change_summary,
            created_by, previous_version_id, char_diff
          ) VALUES ($1, $2, $3, $4, $5, $6, 'edited', $7, $8, $9, $10)`,
          [
            versionId,
            artifact.content_request_id,
            artifact.id,
            nextVersion,
            platform,
            content,
            changeSummary || 'Manual edit',
            req.user!.id,
            prevVersion?.id || null,
            content.length - artifact.content.length,
          ]
        );

        // Update artifact
        await client.query(
          `UPDATE artifacts SET
             edited_content = $1,
             last_edited_by = $2,
             last_edited_at = NOW(),
             current_version_id = $3
           WHERE id = $4`,
          [content, req.user!.id, versionId, artifact.id]
        );
      });

      logger.info('Artifact edited', {
        artifactId: artifact.id,
        version: nextVersion,
        userId: req.user!.id,
      });

      res.json({
        artifactId: artifact.id,
        versionId,
        versionNumber: nextVersion,
        content,
        message: 'Content updated',
      });
    } catch (err) {
      logger.error('PATCH artifact error:', { error: err });
      res.status(500).json({ error: 'Failed to update content' });
    }
  }
);

// ─── POST /api/content/:id/artifacts/:artifactId/refine (AI Refinement) ─────

contentRouter.post(
  '/:id/artifacts/:artifactId/refine',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const parsed = refineSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
        return;
      }

      const { userPrompt, quickTags, preserveLength } = parsed.data;

      if (!userPrompt && quickTags.length === 0) {
        res.status(400).json({ 
          error: 'Provide either userPrompt or quickTags for refinement' 
        });
        return;
      }

      // Fetch artifact with current content
      const artifact = await queryOne<{
        id: string;
        content: string;
        edited_content: string | null;
        content_request_id: string;
        metadata: any;
        refinement_count: number;
      }>(
        `SELECT 
           a.id, 
           a.content,
           a.edited_content,
           a.content_request_id, 
           a.metadata,
           COALESCE(a.refinement_count, 0) as refinement_count
         FROM artifacts a
         JOIN content_requests cr ON cr.id = a.content_request_id
         WHERE a.id = $1 AND cr.organization_id = $2`,
        [req.params.artifactId, req.user!.organizationId]
      );

      if (!artifact) {
        res.status(404).json({ error: 'Artifact not found' });
        return;
      }

      // Use edited content if available, else original
      const sourceContent = artifact.edited_content || artifact.content;

      // Get platform from metadata
      let platform = 'linkedin_post';
      try {
        const meta = typeof artifact.metadata === 'string' 
          ? JSON.parse(artifact.metadata) 
          : artifact.metadata;
        platform = meta?.platform || platform;
      } catch {}

      // Fetch brand profile if request has one
      const request = await queryOne<{ brand_profile_id: string | null }>(
        `SELECT brand_profile_id FROM content_requests WHERE id = $1`,
        [artifact.content_request_id]
      );

      let brandProfile: Record<string, unknown> | null = null;
      if (request?.brand_profile_id) {
        brandProfile = await queryOne(
          `SELECT * FROM brand_profiles WHERE id = $1`,
          [request.brand_profile_id]
        );
      }

      // Call AI Engine Refiner
      const aiUrl = process.env.AI_ENGINE_URL || 'http://localhost:8000';
      logger.info('Calling refiner', { 
        artifactId: artifact.id, 
        platform, 
        hasPrompt: !!userPrompt, 
        tagCount: quickTags.length 
      });

      const aiResponse = await axios.post(
        `${aiUrl}/agents/refiner`,
        {
          content: sourceContent,
          userPrompt,
          quickTags,
          platform,
          brandProfile,
          preserveLength,
        },
        { timeout: 120_000 }
      );

      const refinedContent = aiResponse.data?.content || sourceContent;
      const tokensUsed = aiResponse.data?.tokensUsed || 0;

      // Save version + update artifact
      const versionId = uuidv4();
      const nextVersion = artifact.refinement_count + 2; // +1 for current, +1 for new

      const prevVersion = await queryOne<{ id: string }>(
        `SELECT id FROM content_versions
         WHERE artifact_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [artifact.id]
      );

      await withTransaction(async (client) => {
        // Create version
        await client.query(
          `INSERT INTO content_versions (
            id, content_request_id, artifact_id, version_number,
            platform, content, change_type, change_summary,
            user_prompt, quick_tags, tokens_used,
            created_by, previous_version_id, char_diff
          ) VALUES ($1, $2, $3, $4, $5, $6, 'refined', $7, $8, $9, $10, $11, $12, $13)`,
          [
            versionId,
            artifact.content_request_id,
            artifact.id,
            nextVersion,
            platform,
            refinedContent,
            buildRefineSummary(userPrompt, quickTags),
            userPrompt || '',
            JSON.stringify(quickTags),
            tokensUsed,
            req.user!.id,
            prevVersion?.id || null,
            refinedContent.length - sourceContent.length,
          ]
        );

        // Update artifact
        await client.query(
          `UPDATE artifacts SET
             edited_content = $1,
             last_edited_by = $2,
             last_edited_at = NOW(),
             refinement_count = refinement_count + 1,
             current_version_id = $3
           WHERE id = $4`,
          [refinedContent, req.user!.id, versionId, artifact.id]
        );

        // Update total refinements on request
        await client.query(
          `UPDATE content_requests 
           SET total_refinements = COALESCE(total_refinements, 0) + 1
           WHERE id = $1`,
          [artifact.content_request_id]
        );
      });

      logger.info('Content refined', {
        artifactId: artifact.id,
        version: nextVersion,
        tokens: tokensUsed,
      });

      res.json({
        artifactId: artifact.id,
        versionId,
        versionNumber: nextVersion,
        content: refinedContent,
        tokensUsed,
        message: 'Content refined successfully',
      });
    } catch (err) {
      logger.error('POST refine error:', { error: err });
      
      if (axios.isAxiosError(err)) {
        const detail = err.response?.data?.detail || err.message;
        res.status(500).json({ 
          error: 'AI refinement failed', 
          detail: String(detail).slice(0, 300) 
        });
        return;
      }
      
      res.status(500).json({ error: 'Failed to refine content' });
    }
  }
);

// ─── POST /api/content/:id/artifacts/:artifactId/reject (FIXED) ─────────────

contentRouter.post(
  '/:id/artifacts/:artifactId/reject',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const parsed = rejectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ 
          error: 'Rejection reason required (min 3 chars)', 
          details: parsed.error.errors 
        });
        return;
      }

      const { reason, note } = parsed.data;

      // Verify ownership
      const artifact = await queryOne<{ id: string; content_request_id: string }>(
        `SELECT a.id, a.content_request_id
         FROM artifacts a
         JOIN content_requests cr ON cr.id = a.content_request_id
         WHERE a.id = $1 AND cr.organization_id = $2`,
        [req.params.artifactId, req.user!.organizationId]
      );

      if (!artifact) {
        res.status(404).json({ error: 'Artifact not found' });
        return;
      }

      await withTransaction(async (client) => {
        // Update artifact
        await client.query(
          `UPDATE artifacts
           SET status = 'rejected', 
               rejection_note = $1
           WHERE id = $2`,
          [note || reason, artifact.id]
        );

        // Check if all artifacts rejected → mark request as rejected
        const activeArtifacts = await client.query(
          `SELECT COUNT(*) as count FROM artifacts
           WHERE content_request_id = $1 
             AND status NOT IN ('rejected')`,
          [artifact.content_request_id]
        );

        if (parseInt(activeArtifacts.rows[0].count) === 0) {
          await client.query(
            `UPDATE content_requests
             SET status = 'rejected',
                 rejection_reason = $1,
                 rejected_by = $2,
                 rejected_at = NOW()
             WHERE id = $3`,
            [reason, req.user!.id, artifact.content_request_id]
          );
        }
      });

      logger.info('Artifact rejected', {
        artifactId: artifact.id,
        reason: reason.slice(0, 50),
        userId: req.user!.id,
      });

      res.json({ 
        message: 'Content rejected',
        artifactId: artifact.id,
      });
    } catch (err) {
      logger.error('POST reject error:', { error: err });
      res.status(500).json({ error: 'Failed to reject content' });
    }
  }
);

// ─── GET /api/content/:id/artifacts/:artifactId/versions (History) ──────────

contentRouter.get(
  '/:id/artifacts/:artifactId/versions',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      // Verify ownership
      const artifact = await queryOne(
        `SELECT a.id FROM artifacts a
         JOIN content_requests cr ON cr.id = a.content_request_id
         WHERE a.id = $1 AND cr.organization_id = $2`,
        [req.params.artifactId, req.user!.organizationId]
      );

      if (!artifact) {
        res.status(404).json({ error: 'Artifact not found' });
        return;
      }

      const versions = await query(
        `SELECT 
           cv.id,
           cv.version_number,
           cv.platform,
           cv.content,
           cv.change_type,
           cv.change_summary,
           cv.user_prompt,
           cv.quick_tags,
           cv.tokens_used,
           cv.char_diff,
           cv.created_at,
           u.name as created_by_name,
           u.email as created_by_email
         FROM content_versions cv
         LEFT JOIN users u ON u.id = cv.created_by
         WHERE cv.artifact_id = $1
         ORDER BY cv.version_number DESC`,
        [req.params.artifactId]
      );

      res.json({ 
        artifactId: req.params.artifactId,
        totalVersions: versions.length,
        versions 
      });
    } catch (err) {
      logger.error('GET versions error:', { error: err });
      res.status(500).json({ error: 'Failed to fetch versions' });
    }
  }
);

// ─── POST /api/content/:id/artifacts/:artifactId/restore/:versionId ─────────

contentRouter.post(
  '/:id/artifacts/:artifactId/restore/:versionId',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      // Verify ownership + fetch version
      const version = await queryOne<{
        id: string;
        content: string;
        version_number: number;
        artifact_id: string;
      }>(
        `SELECT cv.id, cv.content, cv.version_number, cv.artifact_id
         FROM content_versions cv
         JOIN artifacts a ON a.id = cv.artifact_id
         JOIN content_requests cr ON cr.id = a.content_request_id
         WHERE cv.id = $1 
           AND a.id = $2 
           AND cr.organization_id = $3`,
        [req.params.versionId, req.params.artifactId, req.user!.organizationId]
      );

      if (!version) {
        res.status(404).json({ error: 'Version not found' });
        return;
      }

      // Update artifact to use this version's content
      await query(
        `UPDATE artifacts SET
           edited_content = $1,
           current_version_id = $2,
           last_edited_by = $3,
           last_edited_at = NOW()
         WHERE id = $4`,
        [version.content, version.id, req.user!.id, req.params.artifactId]
      );

      logger.info('Version restored', {
        artifactId: req.params.artifactId,
        versionId: version.id,
        version: version.version_number,
      });

      res.json({
        artifactId: req.params.artifactId,
        restoredToVersion: version.version_number,
        content: version.content,
        message: `Restored to version ${version.version_number}`,
      });
    } catch (err) {
      logger.error('POST restore error:', { error: err });
      res.status(500).json({ error: 'Failed to restore version' });
    }
  }
);