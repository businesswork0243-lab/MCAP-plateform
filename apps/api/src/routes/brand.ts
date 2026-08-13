// apps/api/src/routes/brand.ts
import { Router, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import multer from 'multer'
import pdfParse = require('pdf-parse')
import mammoth from 'mammoth'
import { query, queryOne, withTransaction } from '../db/connection'
import { AuthenticatedRequest, authenticate } from '../middleware/auth'
import { logger } from '../lib/logger'

export const brandRouter = Router()
brandRouter.use(authenticate)
export default brandRouter

// ─── Multer Setup (memory storage — we'll upload to cloud) ───────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 10,                   // Max 10 files at once
  },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/png',
      'image/jpeg',
    ]
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`))
    }
  },
})

// ─── Schemas ──────────────────────────────────────────────────────────────────

const toneSchema = z.object({
  formality: z.number().min(1).max(10).default(5),
  technical: z.number().min(1).max(10).default(5),
  confidence: z.number().min(1).max(10).default(5),
  emotion: z.number().min(1).max(10).default(5),
  humor: z.number().min(1).max(10).default(2),
  storytelling: z.number().min(1).max(10).default(5),
  persuasiveness: z.number().min(1).max(10).default(5),
  assertiveness: z.number().min(1).max(10).default(5),
  enthusiasm: z.number().min(1).max(10).default(5),
  empathy: z.number().min(1).max(10).default(5),
}).optional()

const brandSchema = z.object({
  // Core
  name: z.string().min(1).max(255),
  website: z.string().url().optional().or(z.literal('')),
  industry: z.string().max(100).optional(),
  description: z.string().optional(),
  mission: z.string().optional(),
  vision: z.string().optional(),
  positioning: z.string().optional(),
  life_purpose: z.string().optional(),

  // Tone
  tone: toneSchema,

  // Vocabulary
  preferredTerms: z.array(z.string()).default([]),
  bannedPhrases: z.array(z.string()).default([]),
  industryVocabulary: z.array(z.string()).default([]),
  keyMessages: z.array(z.string()).default([]),
  valuePropositions: z.array(z.string()).default([]),
  complianceNotes: z.string().optional(),

  // Values & Beliefs (NEW)
  likes: z.array(z.string()).default([]),
  hates: z.array(z.string()).default([]),
  dislikes: z.array(z.string()).default([]),
  stands_for: z.array(z.string()).default([]),
  stands_against: z.array(z.string()).default([]),
  core_motivations: z.array(z.string()).default([]),
  core_values: z.array(z.string()).default([]),

  // Meta
  isDefault: z.boolean().default(false),
  client_id: z.string().uuid().optional(),
})

const icpSchema = z.object({
  name: z.string().min(1).max(255),
  brand_profile_id: z.string().uuid().optional(),
  basic_characteristics: z.record(z.string()).default({}),
  interests: z.array(z.string()).default([]),
  information_sources: z.array(z.string()).default([]),
  lifestyle_hobbies: z.string().optional(),
  current_challenges: z.array(z.string()).default([]),
  previous_solutions: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  emotional_motivations: z.array(z.string()).default([]),
  frustrations: z.array(z.string()).default([]),
  personality_scores: z.record(z.number()).default({}),
  need_hierarchy: z.record(z.unknown()).default({}),
  time_expectations: z.record(z.unknown()).default({}),
  success_criteria: z.array(z.string()).default([]),
  positioning_strategy: z.string().optional(),
  roi_expectations: z.record(z.unknown()).default({}),
  risk_perception: z.string().optional(),
  non_ideal_notes: z.string().optional(),
})

const writingStructureSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  structure_flow: z.array(z.string()).min(1),
})

// ─── Helper: Build tone update fields ─────────────────────────────────────────

function buildToneFields(tone: Record<string, number> | undefined): {
  fields: string[];
  values: unknown[];
} {
  if (!tone) return { fields: [], values: [] }
  const map: Record<string, string> = {
    formality: 'tone_formality',
    technical: 'tone_technical',
    confidence: 'tone_confidence',
    emotion: 'tone_emotion',
    humor: 'tone_humor',
    storytelling: 'tone_storytelling',
    persuasiveness: 'tone_persuasiveness',
    assertiveness: 'tone_assertiveness',
    enthusiasm: 'tone_enthusiasm',
    empathy: 'tone_empathy',
  }
  const fields: string[] = []
  const values: unknown[] = []
  for (const [key, col] of Object.entries(map)) {
    if (tone[key] !== undefined) {
      fields.push(col)
      values.push(tone[key])
    }
  }
  return { fields, values }
}

// ─── BRAND PROFILE ROUTES ──────────────────────────────────────────────────

// GET /api/brand
brandRouter.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const profiles = await query(
      `SELECT bp.*,
        (SELECT COUNT(*) FROM icp_profiles WHERE brand_profile_id = bp.id) as icp_count,
        (SELECT COUNT(*) FROM brand_documents WHERE brand_profile_id = bp.id) as doc_count
       FROM brand_profiles bp
       WHERE bp.organization_id = $1
       ORDER BY bp.is_default DESC, bp.name`,
      [req.user!.organizationId]
    )
    res.json({ profiles })
  } catch (err) {
    logger.error('GET /brand error:', { error: err })
    res.status(500).json({ error: 'Failed to fetch brand profiles' })
  }
})

// GET /api/brand/:id
brandRouter.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const profile = await queryOne(
      `SELECT bp.*,
        (SELECT json_agg(row_to_json(d)) FROM brand_documents d WHERE d.brand_profile_id = bp.id) as documents,
        (SELECT json_agg(row_to_json(i)) FROM icp_profiles i WHERE i.brand_profile_id = bp.id) as icp_profiles
       FROM brand_profiles bp
       WHERE bp.id = $1 AND bp.organization_id = $2`,
      [req.params.id, req.user!.organizationId]
    )
    if (!profile) { res.status(404).json({ error: 'Not found' }); return }
    res.json(profile)
  } catch (err) {
    logger.error('GET /brand/:id error:', { error: err })
    res.status(500).json({ error: 'Failed to fetch brand profile' })
  }
})

// POST /api/brand
brandRouter.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parsed = brandSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors })
      return
    }
    const d = parsed.data

    const id = await withTransaction(async (client) => {
      // Reset default if needed
      if (d.isDefault) {
        await client.query(
          'UPDATE brand_profiles SET is_default = false WHERE organization_id = $1',
          [req.user!.organizationId]
        )
      }

      const newId = uuidv4()
      const tone = (d.tone ?? {}) as any

      await client.query(
        `INSERT INTO brand_profiles (
          id, organization_id, client_id,
          name, website, industry, description, mission, vision, positioning, life_purpose,
          tone_formality, tone_technical, tone_confidence, tone_emotion,
          tone_humor, tone_storytelling, tone_persuasiveness, tone_assertiveness,
          tone_enthusiasm, tone_empathy,
          preferred_terms, banned_phrases, industry_vocabulary,
          key_messages, value_propositions, compliance_notes,
          likes, hates, dislikes, stands_for, stands_against,
          core_motivations, core_values,
          is_default
        ) VALUES (
          $1,$2,$3,
          $4,$5,$6,$7,$8,$9,$10,$11,
          $12,$13,$14,$15,
          $16,$17,$18,$19,
          $20,$21,
          $22,$23,$24,
          $25,$26,$27,
          $28,$29,$30,$31,$32,
          $33,$34,
          $35
        )`,
        [
          newId, req.user!.organizationId, d.client_id ?? null,
          d.name, d.website ?? null, d.industry ?? null,
          d.description ?? null, d.mission ?? null, d.vision ?? null,
          d.positioning ?? null, d.life_purpose ?? null,
          tone.formality ?? 5, tone.technical ?? 5,
          tone.confidence ?? 5, tone.emotion ?? 5,
          tone.humor ?? 2, tone.storytelling ?? 5,
          tone.persuasiveness ?? 5, tone.assertiveness ?? 5,
          tone.enthusiasm ?? 5, tone.empathy ?? 5,
          JSON.stringify(d.preferredTerms),
          JSON.stringify(d.bannedPhrases),
          JSON.stringify(d.industryVocabulary),
          JSON.stringify(d.keyMessages),
          JSON.stringify(d.valuePropositions),
          d.complianceNotes ?? null,
          JSON.stringify(d.likes),
          JSON.stringify(d.hates),
          JSON.stringify(d.dislikes),
          JSON.stringify(d.stands_for),
          JSON.stringify(d.stands_against),
          JSON.stringify(d.core_motivations),
          JSON.stringify(d.core_values),
          d.isDefault,
        ]
      )
      return newId
    })

    const profile = await queryOne(
      'SELECT * FROM brand_profiles WHERE id = $1',
      [id]
    )
    res.status(201).json(profile)
  } catch (err) {
    logger.error('POST /brand error:', { error: err })
    res.status(500).json({ error: 'Failed to create brand profile' })
  }
})

// PUT /api/brand/:id
brandRouter.put('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parsed = brandSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors })
      return
    }
    const d = parsed.data

    const existing = await queryOne(
      'SELECT id FROM brand_profiles WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.organizationId]
    )
    if (!existing) { res.status(404).json({ error: 'Not found' }); return }

    await withTransaction(async (client) => {
      if (d.isDefault) {
        await client.query(
          'UPDATE brand_profiles SET is_default = false WHERE organization_id = $1',
          [req.user!.organizationId]
        )
      }

      // Build dynamic SET clause
      const sets: string[] = []
      const vals: unknown[] = []
      let idx = 1

      const simpleFields: Array<[keyof typeof d, string]> = [
        ['name', 'name'],
        ['website', 'website'],
        ['industry', 'industry'],
        ['description', 'description'],
        ['mission', 'mission'],
        ['vision', 'vision'],
        ['positioning', 'positioning'],
        ['life_purpose', 'life_purpose'],
        ['complianceNotes', 'compliance_notes'],
        ['isDefault', 'is_default'],
        ['client_id', 'client_id'],
      ]

      for (const [key, col] of simpleFields) {
        if (d[key] !== undefined) {
          sets.push(`${col} = $${idx++}`)
          vals.push(d[key])
        }
      }

      // JSON array fields
      const jsonFields: Array<[keyof typeof d, string]> = [
        ['preferredTerms', 'preferred_terms'],
        ['bannedPhrases', 'banned_phrases'],
        ['industryVocabulary', 'industry_vocabulary'],
        ['keyMessages', 'key_messages'],
        ['valuePropositions', 'value_propositions'],
        ['likes', 'likes'],
        ['hates', 'hates'],
        ['dislikes', 'dislikes'],
        ['stands_for', 'stands_for'],
        ['stands_against', 'stands_against'],
        ['core_motivations', 'core_motivations'],
        ['core_values', 'core_values'],
      ]

      for (const [key, col] of jsonFields) {
        if (d[key] !== undefined) {
          sets.push(`${col} = $${idx++}`)
          vals.push(JSON.stringify(d[key]))
        }
      }

      // Tone fields
      if (d.tone) {
        const { fields, values } = buildToneFields(d.tone as Record<string, number>)
        for (let i = 0; i < fields.length; i++) {
          sets.push(`${fields[i]} = $${idx++}`)
          vals.push(values[i])
        }
      }

      if (sets.length === 0) return

      sets.push(`updated_at = NOW()`)
      vals.push(req.params.id)

      await client.query(
        `UPDATE brand_profiles SET ${sets.join(', ')} WHERE id = $${idx}`,
        vals
      )
    })

    const profile = await queryOne(
      'SELECT * FROM brand_profiles WHERE id = $1',
      [req.params.id]
    )
    res.json(profile)
  } catch (err) {
    logger.error('PUT /brand error:', { error: err })
    res.status(500).json({ error: 'Failed to update brand profile' })
  }
})

// DELETE /api/brand/:id
brandRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await query(
      'DELETE FROM brand_profiles WHERE id = $1 AND organization_id = $2 RETURNING id',
      [req.params.id, req.user!.organizationId]
    )
    if (!result.length) { res.status(404).json({ error: 'Not found' }); return }
    res.json({ message: 'Deleted' })
  } catch (err) {
    logger.error('DELETE /brand error:', { error: err })
    res.status(500).json({ error: 'Failed to delete brand profile' })
  }
})

// ─── Document Text Extractor ──────────────────────────────────────────────────

async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<{ text: string; method: string }> {

  try {
    // PDF
    if (mimeType === 'application/pdf') {
      const data = await (pdfParse as any)(buffer)
      return {
        text: data.text.trim(),
        method: 'pdf-parse',
      }
    }

    // DOCX
    if (
      mimeType === 'application/vnd.openxmlformats-officedocument' +
      '.wordprocessingml.document'
    ) {
      const result = await mammoth.extractRawText({ buffer })
      return {
        text: result.value.trim(),
        method: 'mammoth',
      }
    }

    // Plain text
    if (mimeType === 'text/plain') {
      return {
        text: buffer.toString('utf-8').trim(),
        method: 'text',
      }
    }

    // Image — skip text extraction
    if (mimeType.startsWith('image/')) {
      return {
        text: `[Image file: ${fileName} — visual reference only]`,
        method: 'image-skip',
      }
    }

    // DOC (old format)
    if (mimeType === 'application/msword') {
      return {
        text: buffer.toString('utf-8').replace(/[^\x20-\x7E\n]/g, ' ').trim(),
        method: 'doc-fallback',
      }
    }

    return { text: '', method: 'unsupported' }

  } catch (parseErr) {
    logger.warn('Text extraction failed', {
      mimeType,
      fileName,
      error: parseErr instanceof Error ? parseErr.message : parseErr,
    })
    return { text: '', method: 'failed' }
  }
}

// ─── Smart Text Chunker for Large Documents ───────────────────────────────────

function smartChunkText(text: string, maxChars = 8000): string {
  if (text.length <= maxChars) return text

  // Important sections pehle rakhein
  const importantKeywords = [
    'tone of voice', 'brand voice', 'writing style',
    'do not', "don't", 'avoid', 'never use',
    'always use', 'preferred', 'banned', 'guidelines',
    'mission', 'vision', 'values', 'personality',
    'messaging', 'key messages', 'brand personality',
  ]

  const lines = text.split('\n')
  const important: string[] = []
  const normal: string[] = []

  for (const line of lines) {
    const lower = line.toLowerCase()
    const isImportant = importantKeywords.some(kw => lower.includes(kw))
    if (isImportant) {
      important.push(line)
    } else {
      normal.push(line)
    }
  }

  // Important lines pehle, phir baaki content
  const combined = [...important, ...normal].join('\n')
  return combined.slice(0, maxChars) +
    (combined.length > maxChars ? '\n... [document truncated]' : '')
}

// ─── Brand Document Summary Refresh ──────────────────────────────────────────

async function refreshBrandDocumentSummary(brandProfileId: string): Promise<void> {
  try {
    const docs = await query<{ parsed_content: string; name: string }>(
      `SELECT name, parsed_content 
       FROM brand_documents 
       WHERE brand_profile_id = $1 
         AND parsing_status = 'done'
         AND parsed_content IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 5`,
      [brandProfileId]
    )

    if (docs.length === 0) return

    // Combine karo saare docs ka content (with labels)
    const combined = docs
      .map(d => `=== Document: ${d.name} ===\n${d.parsed_content}`)
      .join('\n\n')

    // Max 10000 chars (multiple docs ho sakte hain)
    const summary = combined.slice(0, 10000)

    logger.info('Brand document summary updated', {
      brandProfileId,
      docCount: docs.length,
      summaryLength: summary.length,
    })

  } catch (err) {
    logger.warn('Failed to refresh brand summary', { error: err })
  }
}

// ─── DOCUMENT ROUTES ──────────────────────────────────────────────────────────

// POST /api/brand/:id/documents
brandRouter.post(
  '/:id/documents',
  upload.array('files', 10),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const profile = await queryOne(
        'SELECT id FROM brand_profiles WHERE id = $1 AND organization_id = $2',
        [req.params.id, req.user!.organizationId]
      )
      if (!profile) {
        res.status(404).json({ error: 'Brand profile not found' })
        return
      }

      const files = req.files as Express.Multer.File[]
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No files uploaded' })
        return
      }

      const savedDocs: any[] = []

      for (const file of files) {
        const docId = uuidv4()

        // ✅ Step 1: Text extract karo immediately (buffer available hai)
        logger.info('Extracting text from document', {
          name: file.originalname,
          mime: file.mimetype,
          size: file.size,
        })

        const { text: rawText, method } = await extractTextFromBuffer(
          file.buffer,
          file.mimetype,
          file.originalname
        )

        // ✅ Step 2: Smart chunk for AI context
        const parsedContent = rawText ? smartChunkText(rawText) : null
        const parsingStatus = parsedContent ? 'done' :
          method === 'image-skip' ? 'done' : 'failed'

        logger.info('Document parsed', {
          docId,
          method,
          rawLength: rawText.length,
          parsedLength: parsedContent?.length ?? 0,
          status: parsingStatus,
        })

        // ✅ Step 3: DB mein save karo WITH parsed content
        await query(
          `INSERT INTO brand_documents
            (id, brand_profile_id, organization_id, uploaded_by,
             name, file_url, file_size, mime_type,
             parsed_content, parsing_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            docId,
            req.params.id,
            req.user!.organizationId,
            req.user!.id,
            file.originalname,
            `local://${docId}/${file.originalname}`, // placeholder URL
            file.size,
            file.mimetype,
            parsedContent,                            // ✅ actual text
            parsingStatus,                            // ✅ 'done' ya 'failed'
          ]
        )

        savedDocs.push({
          id: docId,
          name: file.originalname,
          size: file.size,
          type: file.mimetype,
          status: parsingStatus,                // ✅ real status
          parsedChars: parsedContent?.length ?? 0,
          extractMethod: method,
        })
      }

      // ✅ Step 4: Brand profile ka summary update karo
      // Aggregate karo saare documents ka parsed content
      await refreshBrandDocumentSummary(req.params.id)

      res.status(201).json({ documents: savedDocs })

    } catch (err) {
      logger.error('POST /brand/:id/documents error:', { error: err })
      res.status(500).json({ error: 'Failed to upload documents' })
    }
  }
)

// GET /api/brand/:id/documents
brandRouter.get('/:id/documents', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const profile = await queryOne(
      'SELECT id FROM brand_profiles WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.organizationId]
    )
    if (!profile) { res.status(404).json({ error: 'Not found' }); return }

    const docs = await query(
      'SELECT id, name, file_url, file_size, mime_type, parsing_status, created_at FROM brand_documents WHERE brand_profile_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    )
    res.json({ documents: docs })
  } catch (err) {
    logger.error('GET /brand/:id/documents error:', { error: err })
    res.status(500).json({ error: 'Failed to fetch documents' })
  }
})

// DELETE /api/brand/:id/documents/:docId
brandRouter.delete('/:id/documents/:docId', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await query(
      `DELETE FROM brand_documents
       WHERE id = $1 AND brand_profile_id = $2 AND organization_id = $3`,
      [req.params.docId, req.params.id, req.user!.organizationId]
    )

    // TODO: Delete from cloud storage
    // await deleteFromStorage(docUrl)

    res.json({ message: 'Document deleted' })
  } catch (err) {
    logger.error('DELETE /brand/:id/documents/:docId error:', { error: err })
    res.status(500).json({ error: 'Failed to delete document' })
  }
})

// ─── ICP PROFILE ROUTES ───────────────────────────────────────────────────────

// GET /api/brand/icps  (all ICPs for org)
brandRouter.get('/icps/all', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const icps = await query(
      `SELECT i.*, bp.name as brand_profile_name
       FROM icp_profiles i
       LEFT JOIN brand_profiles bp ON bp.id = i.brand_profile_id
       WHERE i.organization_id = $1
       ORDER BY i.created_at DESC`,
      [req.user!.organizationId]
    )
    res.json({ icps })
  } catch (err) {
    logger.error('GET /brand/icps/all error:', { error: err })
    res.status(500).json({ error: 'Failed to fetch ICPs' })
  }
})

// GET /api/brand/:id/icps
brandRouter.get('/:id/icps', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const icps = await query(
      'SELECT * FROM icp_profiles WHERE brand_profile_id = $1 AND organization_id = $2 ORDER BY created_at DESC',
      [req.params.id, req.user!.organizationId]
    )
    res.json({ icps })
  } catch (err) {
    logger.error('GET /brand/:id/icps error:', { error: err })
    res.status(500).json({ error: 'Failed to fetch ICPs' })
  }
})

// POST /api/brand/:id/icps
brandRouter.post('/:id/icps', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parsed = icpSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors })
      return
    }

    // Verify brand profile belongs to org
    const profile = await queryOne(
      'SELECT id FROM brand_profiles WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.organizationId]
    )
    if (!profile) { res.status(404).json({ error: 'Brand profile not found' }); return }

    const d = parsed.data
    const id = uuidv4()

    await query(
      `INSERT INTO icp_profiles (
        id, organization_id, brand_profile_id, created_by,
        name, basic_characteristics, interests, information_sources,
        lifestyle_hobbies, current_challenges, previous_solutions,
        goals, emotional_motivations, frustrations,
        personality_scores, need_hierarchy, time_expectations,
        success_criteria, positioning_strategy, roi_expectations,
        risk_perception, non_ideal_notes
      ) VALUES (
        $1,$2,$3,$4,
        $5,$6,$7,$8,
        $9,$10,$11,
        $12,$13,$14,
        $15,$16,$17,
        $18,$19,$20,
        $21,$22
      )`,
      [
        id, req.user!.organizationId, req.params.id, req.user!.id,
        d.name,
        JSON.stringify(d.basic_characteristics),
        JSON.stringify(d.interests),
        JSON.stringify(d.information_sources),
        d.lifestyle_hobbies ?? null,
        JSON.stringify(d.current_challenges),
        JSON.stringify(d.previous_solutions),
        JSON.stringify(d.goals),
        JSON.stringify(d.emotional_motivations),
        JSON.stringify(d.frustrations),
        JSON.stringify(d.personality_scores),
        JSON.stringify(d.need_hierarchy),
        JSON.stringify(d.time_expectations),
        JSON.stringify(d.success_criteria),
        d.positioning_strategy ?? null,
        JSON.stringify(d.roi_expectations),
        d.risk_perception ?? null,
        d.non_ideal_notes ?? null,
      ]
    )

    const icp = await queryOne('SELECT * FROM icp_profiles WHERE id = $1', [id])
    res.status(201).json(icp)
  } catch (err) {
    logger.error('POST /brand/:id/icps error:', { error: err })
    res.status(500).json({ error: 'Failed to create ICP' })
  }
})

// PUT /api/brand/:id/icps/:icpId
brandRouter.put('/:id/icps/:icpId', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parsed = icpSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors })
      return
    }

    const existing = await queryOne(
      'SELECT id FROM icp_profiles WHERE id = $1 AND organization_id = $2',
      [req.params.icpId, req.user!.organizationId]
    )
    if (!existing) { res.status(404).json({ error: 'ICP not found' }); return }

    const d = parsed.data
    const sets: string[] = []
    const vals: unknown[] = []
    let idx = 1

    // JSON fields
    const jsonCols = [
      'basic_characteristics', 'interests', 'information_sources',
      'current_challenges', 'previous_solutions', 'goals',
      'emotional_motivations', 'frustrations', 'personality_scores',
      'need_hierarchy', 'time_expectations', 'success_criteria',
      'roi_expectations',
    ] as const

    for (const col of jsonCols) {
      if (d[col] !== undefined) {
        sets.push(`${col} = $${idx++}`)
        vals.push(JSON.stringify(d[col]))
      }
    }

    // Text fields
    const textCols = [
      ['name', 'name'],
      ['lifestyle_hobbies', 'lifestyle_hobbies'],
      ['positioning_strategy', 'positioning_strategy'],
      ['risk_perception', 'risk_perception'],
      ['non_ideal_notes', 'non_ideal_notes'],
    ] as const

    for (const [key, col] of textCols) {
      if (d[key] !== undefined) {
        sets.push(`${col} = $${idx++}`)
        vals.push(d[key])
      }
    }

    if (sets.length === 0) { res.json({ message: 'Nothing to update' }); return }

    sets.push('updated_at = NOW()')
    vals.push(req.params.icpId)

    await query(
      `UPDATE icp_profiles SET ${sets.join(', ')} WHERE id = $${idx}`,
      vals
    )

    const icp = await queryOne('SELECT * FROM icp_profiles WHERE id = $1', [req.params.icpId])
    res.json(icp)
  } catch (err) {
    logger.error('PUT /brand/:id/icps/:icpId error:', { error: err })
    res.status(500).json({ error: 'Failed to update ICP' })
  }
})

// DELETE /api/brand/:id/icps/:icpId
brandRouter.delete('/:id/icps/:icpId', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await query(
      'DELETE FROM icp_profiles WHERE id = $1 AND organization_id = $2',
      [req.params.icpId, req.user!.organizationId]
    )
    res.json({ message: 'ICP deleted' })
  } catch (err) {
    logger.error('DELETE /brand/:id/icps/:icpId error:', { error: err })
    res.status(500).json({ error: 'Failed to delete ICP' })
  }
})

// ─── WRITING STRUCTURE ROUTES ─────────────────────────────────────────────────

// GET /api/brand/structures
// Returns system structures + org's custom ones
brandRouter.get('/structures/all', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const structures = await query(
      `SELECT * FROM writing_structures
       WHERE is_system = true
          OR organization_id = $1
       ORDER BY is_system DESC, use_count DESC, name`,
      [req.user!.organizationId]
    )
    res.json({ structures })
  } catch (err) {
    logger.error('GET /brand/structures/all error:', { error: err })
    res.status(500).json({ error: 'Failed to fetch structures' })
  }
})

// POST /api/brand/structures
brandRouter.post('/structures', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parsed = writingStructureSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors })
      return
    }

    const d = parsed.data
    const id = uuidv4()

    await query(
      `INSERT INTO writing_structures
        (id, organization_id, created_by, name, description, structure_flow)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        req.user!.organizationId,
        req.user!.id,
        d.name,
        d.description ?? null,
        JSON.stringify(d.structure_flow),
      ]
    )

    const structure = await queryOne(
      'SELECT * FROM writing_structures WHERE id = $1',
      [id]
    )
    res.status(201).json(structure)
  } catch (err) {
    logger.error('POST /brand/structures error:', { error: err })
    res.status(500).json({ error: 'Failed to create writing structure' })
  }
})

// PUT /api/brand/structures/:id
brandRouter.put('/structures/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parsed = writingStructureSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors })
      return
    }

    const existing = await queryOne(
      'SELECT id FROM writing_structures WHERE id = $1 AND organization_id = $2 AND is_system = false',
      [req.params.id, req.user!.organizationId]
    )
    if (!existing) {
      res.status(404).json({ error: 'Structure not found or is a system structure' })
      return
    }

    const d = parsed.data
    const sets: string[] = []
    const vals: unknown[] = []
    let idx = 1

    if (d.name) { sets.push(`name = $${idx++}`); vals.push(d.name) }
    if (d.description !== undefined) { sets.push(`description = $${idx++}`); vals.push(d.description) }
    if (d.structure_flow) { sets.push(`structure_flow = $${idx++}`); vals.push(JSON.stringify(d.structure_flow)) }

    if (sets.length === 0) { res.json({ message: 'Nothing to update' }); return }

    sets.push('updated_at = NOW()')
    vals.push(req.params.id)

    await query(
      `UPDATE writing_structures SET ${sets.join(', ')} WHERE id = $${idx}`,
      vals
    )

    const structure = await queryOne(
      'SELECT * FROM writing_structures WHERE id = $1',
      [req.params.id]
    )
    res.json(structure)
  } catch (err) {
    logger.error('PUT /brand/structures/:id error:', { error: err })
    res.status(500).json({ error: 'Failed to update writing structure' })
  }
})

// DELETE /api/brand/structures/:id
brandRouter.delete('/structures/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await query(
      `DELETE FROM writing_structures
       WHERE id = $1 AND organization_id = $2 AND is_system = false
       RETURNING id`,
      [req.params.id, req.user!.organizationId]
    )
    if (!result.length) {
      res.status(404).json({ error: 'Not found or cannot delete system structure' })
      return
    }
    res.json({ message: 'Deleted' })
  } catch (err) {
    logger.error('DELETE /brand/structures/:id error:', { error: err })
    res.status(500).json({ error: 'Failed to delete structure' })
  }
})