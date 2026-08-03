import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { query, queryOne, withTransaction } from '../db/connection';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { addContentJob, ContentJobData } from '../jobs/queue';
import { logger } from '../lib/logger';

export const bulkRouter = Router();
bulkRouter.use(authenticate);

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_ROWS = 50;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.csv') || file.originalname.endsWith('.xlsx') || file.originalname.endsWith('.xls')) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx, .xls, or .csv files are allowed'));
    }
  },
});

// ── Row Schema ────────────────────────────────────────────────────────────────

const bulkRowSchema = z.object({
  topic:                z.string().min(3).max(500),
  objective:            z.string().optional().default('Build thought leadership'),
  context:              z.string().optional().default(''),
  platforms:            z.string().min(1),
  writing_structure:    z.string().optional().default('thesis'),
  perspective:          z.string().optional().default('Founder'),
  language:             z.string().optional().default('English'),
  cta_type:             z.string().optional().default('comment'),
  keywords:             z.string().optional().default(''),
  tone_excited:         z.coerce.number().min(0).max(10).optional().default(5),
  tone_confident:       z.coerce.number().min(0).max(10).optional().default(6),
  tone_curious:         z.coerce.number().min(0).max(10).optional().default(4),
  tone_serious:         z.coerce.number().min(0).max(10).optional().default(5),
  humanization_level:   z.enum(['light', 'medium', 'aggressive'])
                         .optional().default('medium'),
  word_count:           z.coerce.number().optional(),
  special_instructions: z.string().optional().default(''),
  brand_profile_name:   z.string().optional().default(''),
  icp_name:             z.string().optional().default(''),
  custom_audience:      z.string().optional().default(''),
  enable_qa:            z.coerce.boolean().optional().default(true),
  seo_enabled:          z.coerce.boolean().optional().default(false),
  seo_primary_keyword:  z.string().optional().default(''),
});

type BulkRow = z.infer<typeof bulkRowSchema>;

// ── Excel Parser ──────────────────────────────────────────────────────────────

interface ParsedRow {
  rowNumber:  number;
  raw:        Record<string, unknown>;
  parsed?:    BulkRow;
  errors:     string[];
  valid:      boolean;
}

function parseExcelFile(buffer: Buffer): ParsedRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  // Find "Content Requests" sheet or use first sheet
  const sheetName =
    workbook.SheetNames.includes('Content Requests')
      ? 'Content Requests'
      : workbook.SheetNames[0];

  const sheet = workbook.Sheets[sheetName];

  // Convert to JSON (first row = headers)
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw:    false,
  });

  const results: ParsedRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const raw  = rows[i];
    const rowNum = i + 2; // +2 because row 1 is header

    // Skip completely empty rows
    const values = Object.values(raw).filter(v => v !== '' && v !== null);
    if (values.length === 0) continue;

    // Normalize keys to lowercase with underscores
    const normalized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(raw)) {
      const normKey = key
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
      normalized[normKey] = val;
    }

    // Validate
    const parsed = bulkRowSchema.safeParse(normalized);

    if (!parsed.success) {
      const errors = parsed.error.errors.map(
        e => `${e.path.join('.')}: ${e.message}`
      );
      results.push({ rowNumber: rowNum, raw, errors, valid: false });
    } else {
      results.push({
        rowNumber: rowNum,
        raw,
        parsed: parsed.data,
        errors: [],
        valid: true,
      });
    }
  }

  return results;
}

// ── Brand/ICP Resolver ────────────────────────────────────────────────────────

interface ResolvedProfiles {
  brandProfileId: string | null;
  brandProfile:   Record<string, unknown> | null;
  icpId:          string | null;
  icpData:        Record<string, unknown> | null;
}

async function resolveProfiles(
  brandName: string,
  icpName:   string,
  orgId:     string
): Promise<ResolvedProfiles> {
  let brandProfileId: string | null = null;
  let brandProfile:   Record<string, unknown> | null = null;
  let icpId:          string | null = null;
  let icpData:        Record<string, unknown> | null = null;

  // Resolve brand profile by name
  if (brandName && brandName.trim()) {
    const brand = await queryOne<Record<string, unknown>>(
      `SELECT * FROM brand_profiles
       WHERE organization_id = $1
         AND LOWER(name) = LOWER($2)
       LIMIT 1`,
      [orgId, brandName.trim()]
    );
    if (brand) {
      brandProfileId = brand.id as string;
      brandProfile   = brand;
    }
  }

  // Resolve ICP by name
  if (icpName && icpName.trim()) {
    const icp = await queryOne<Record<string, unknown>>(
      `SELECT * FROM icp_profiles
       WHERE organization_id = $1
         AND LOWER(name) = LOWER($2)
       LIMIT 1`,
      [orgId, icpName.trim()]
    );
    if (icp) {
      icpId   = icp.id as string;
      icpData = icp;
    }
  }

  return { brandProfileId, brandProfile, icpId, icpData };
}

// ── Build Job Payload ─────────────────────────────────────────────────────────

function buildJobPayload(
  row:           BulkRow,
  resolved:      ResolvedProfiles,
  orgId:         string,
  userId:        string,
  requestId:     string,
  bulkJobId:     string
): Omit<ContentJobData, 'requestId'> {

  // Parse platforms
  const platforms = row.platforms
    .split(',')
    .map(p => p.trim().toLowerCase())
    .filter(Boolean);

  // Parse keywords
  const keywords = row.keywords
    ? row.keywords.split(',').map(k => k.trim()).filter(Boolean)
    : [];

  // Build tonality
  const tonalitySpectrum = {
    excited:   row.tone_excited,
    confident: row.tone_confident,
    curious:   row.tone_curious,
    serious:   row.tone_serious,
    angry:     0,
    frustrated: 0,
    empathetic: 5,
    playful:   3,
  };

  // Resolve audience
  let audience = 'General Business';
  let icpDescription = '';

  if (resolved.icpData) {
    const basic = resolved.icpData.basic_characteristics as Record<string, string> | null;
    audience = [basic?.role, basic?.industry].filter(Boolean).join(' in ') || 'General Business';
    icpDescription = `Challenges: ${JSON.stringify(resolved.icpData.current_challenges)}`;
  } else if (row.custom_audience) {
    audience = row.custom_audience;
  }

  return {
    organizationId:        orgId,
    createdBy:             userId,
    topic:                 row.topic,
    objective:             row.objective,
    context:               row.context,
    audience,
    icp_description:       icpDescription,
    perspective:           row.perspective,
    writing_structure:     row.writing_structure,
    cta:                   row.cta_type,
    targetPlatforms:       platforms,
    targetPlatform:        platforms[0],
    brandProfile:          resolved.brandProfile,
    brandProfileId:        resolved.brandProfileId ?? undefined,
    enableHumanization:    true,
    humanizationIntensity: row.humanization_level,
    enableQA:              row.enable_qa,
    language:              row.language,
    keywords,
    specialInstructions:   row.special_instructions,
    seoEnabled:            row.seo_enabled,
    seoSettings:           row.seo_primary_keyword
      ? { primaryKeyword: row.seo_primary_keyword }
      : {},
    tonalitySpectrum,
    wordCount:             row.word_count,
  };
}

// ── POST /api/content/bulk/validate ──────────────────────────────────────────

bulkRouter.post(
  '/validate',
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const rows = parseExcelFile(req.file.buffer);

      if (rows.length === 0) {
        res.status(400).json({ error: 'File appears empty. Check sheet name is "Content Requests".' });
        return;
      }

      if (rows.length > MAX_ROWS) {
        res.status(400).json({
          error:   `Too many rows. Maximum is ${MAX_ROWS} rows per upload.`,
          found:   rows.length,
          maximum: MAX_ROWS,
        });
        return;
      }

      // Validate brand/ICP names against saved profiles
      const orgId = req.user!.organizationId;

      // Fetch all brand profiles for this org (for name validation)
      const brandProfiles = await query<{ id: string; name: string }>(
        'SELECT id, name FROM brand_profiles WHERE organization_id = $1',
        [orgId]
      );

      const icpProfiles = await query<{ id: string; name: string }>(
        'SELECT id, name FROM icp_profiles WHERE organization_id = $1',
        [orgId]
      );

      const brandNames = brandProfiles.map(b => b.name.toLowerCase());
      const icpNames   = icpProfiles.map(i => i.name.toLowerCase());

      // Enrich validation with brand/ICP warnings
      const enrichedRows = rows.map(row => {
        const warnings: string[] = [];

        if (row.valid && row.parsed) {
          const bn = row.parsed.brand_profile_name?.toLowerCase();
          const in_ = row.parsed.icp_name?.toLowerCase();

          if (bn && !brandNames.includes(bn)) {
            warnings.push(
              `Brand profile "${row.parsed.brand_profile_name}" not found. ` +
              `Available: ${brandProfiles.map(b => b.name).join(', ') || 'none'}`
            );
          }

          if (in_ && !icpNames.includes(in_)) {
            warnings.push(
              `ICP profile "${row.parsed.icp_name}" not found. ` +
              `Available: ${icpProfiles.map(i => i.name).join(', ') || 'none'}`
            );
          }
        }

        return { ...row, warnings };
      });

      const validCount   = enrichedRows.filter(r => r.valid).length;
      const invalidCount = enrichedRows.filter(r => !r.valid).length;

      res.json({
        totalRows:    rows.length,
        validRows:    validCount,
        invalidRows:  invalidCount,
        canProceed:   validCount > 0,
        rows:         enrichedRows,
        brandProfiles: brandProfiles.map(b => b.name),
        icpProfiles:   icpProfiles.map(i => i.name),
      });
    } catch (err) {
      logger.error('POST /bulk/validate error:', { error: err });
      res.status(500).json({ error: 'Failed to parse file' });
    }
  }
);

// ── POST /api/content/bulk/upload ─────────────────────────────────────────────

bulkRouter.post(
  '/upload',
  upload.single('file'),
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      const orgId  = req.user!.organizationId;
      const userId = req.user!.id;

      const rows = parseExcelFile(req.file.buffer);
      const validRows = rows.filter(r => r.valid && r.parsed);

      if (validRows.length === 0) {
        res.status(400).json({
          error: 'No valid rows found in the file',
          details: rows.map(r => ({
            row:    r.rowNumber,
            errors: r.errors,
          })),
        });
        return;
      }

      if (validRows.length > MAX_ROWS) {
        res.status(400).json({
          error: `Too many rows. Maximum ${MAX_ROWS} allowed.`,
        });
        return;
      }

      // Create bulk job + individual requests in transaction
      const bulkJobId = uuidv4();

      await withTransaction(async (client) => {
        // Create bulk job record
        await client.query(
          `INSERT INTO bulk_jobs
            (id, organization_id, created_by, original_filename,
             total_rows, status, queued_count)
           VALUES ($1, $2, $3, $4, $5, 'processing', $5)`,
          [
            bulkJobId,
            orgId,
            userId,
            req.file!.originalname,
            validRows.length,
          ]
        );

        // Create individual content requests
        for (const row of validRows) {
          const data = row.parsed!;
          const requestId = uuidv4();

          const platforms = data.platforms
            .split(',')
            .map(p => p.trim())
            .filter(Boolean);

          await client.query(
            `INSERT INTO content_requests (
              id, organization_id, created_by,
              topic, objective, context,
              platforms, target_platform,
              writing_structure, narrative_perspective,
              cta_type, language,
              humanization_enabled, humanization_level,
              qa_enabled, special_instructions,
              keywords, seo_enabled,
              status, bulk_job_id, bulk_row_number,
              bulk_row_data
            ) VALUES (
              $1,$2,$3,
              $4,$5,$6,
              $7,$8,
              $9,$10,
              $11,$12,
              $13,$14,
              $15,$16,
              $17,$18,
              'queued',$19,$20,
              $21
            )`,
            [
              requestId, orgId, userId,
              data.topic, data.objective, data.context,
              JSON.stringify(platforms), platforms[0],
              data.writing_structure, data.perspective,
              data.cta_type, data.language,
              true, data.humanization_level,
              data.enable_qa, data.special_instructions,
              JSON.stringify(
                data.keywords.split(',').map(k => k.trim()).filter(Boolean)
              ),
              data.seo_enabled,
              bulkJobId, row.rowNumber,
              JSON.stringify(data),
            ]
          );
        }
      });

      // Queue jobs AFTER transaction commits
      let queuedCount = 0;

      for (const row of validRows) {
        try {
          const data = row.parsed!;

          // Resolve brand/ICP
          const resolved = await resolveProfiles(
            data.brand_profile_name,
            data.icp_name,
            orgId
          );

          // Get the request ID we created above
          const contentRequest = await queryOne<{ id: string }>(
            `SELECT id FROM content_requests
             WHERE bulk_job_id = $1 AND bulk_row_number = $2`,
            [bulkJobId, row.rowNumber]
          );

          if (!contentRequest) continue;

          const jobPayload = buildJobPayload(
            data, resolved, orgId, userId,
            contentRequest.id, bulkJobId
          );

          await addContentJob(contentRequest.id, jobPayload);
          queuedCount++;

        } catch (rowErr) {
          logger.error('Failed to queue bulk row', {
            bulkJobId,
            rowNumber: row.rowNumber,
            error:     rowErr,
          });
        }
      }

      // Update queued count
      await query(
        'UPDATE bulk_jobs SET queued_count = $1 WHERE id = $2',
        [queuedCount, bulkJobId]
      );

      logger.info('Bulk job created', {
        bulkJobId,
        totalRows: validRows.length,
        queued:    queuedCount,
        orgId,
        userId,
      });

      res.status(202).json({
        bulkJobId,
        totalRows:   validRows.length,
        queuedRows:  queuedCount,
        invalidRows: rows.length - validRows.length,
        message:     `${queuedCount} content pieces queued for generation`,
      });

    } catch (err) {
      logger.error('POST /bulk/upload error:', { error: err });
      res.status(500).json({ error: 'Failed to process file' });
    }
  }
);

// ── GET /api/content/bulk/history ─────────────────────────────────────────────
// NOTE: Placed BEFORE GET /:id to prevent "history" from matching as a UUID :id parameter.

bulkRouter.get(
  '/history',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const jobs = await query(
        `SELECT
           bj.*,
           u.name AS created_by_name
         FROM bulk_jobs bj
         LEFT JOIN users u ON u.id = bj.created_by
         WHERE bj.organization_id = $1
         ORDER BY bj.created_at DESC
         LIMIT 20`,
        [req.user!.organizationId]
      );

      res.json({ jobs });
    } catch (err) {
      logger.error('GET /bulk/history error:', { error: err });
      res.status(500).json({ error: 'Failed to fetch bulk job history' });
    }
  }
);

// ── GET /api/content/bulk (Root List) ─────────────────────────────────────────

bulkRouter.get(
  '/',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const jobs = await query(
        `SELECT
           bj.*,
           u.name AS created_by_name
         FROM bulk_jobs bj
         LEFT JOIN users u ON u.id = bj.created_by
         WHERE bj.organization_id = $1
         ORDER BY bj.created_at DESC
         LIMIT 20`,
        [req.user!.organizationId]
      );

      res.json({ jobs });
    } catch (err) {
      logger.error('GET /bulk/ error:', { error: err });
      res.status(500).json({ error: 'Failed to fetch bulk job history' });
    }
  }
);

// ── GET /api/content/bulk/:id ─────────────────────────────────────────────────

bulkRouter.get(
  '/:id',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const bulkJob = await queryOne<Record<string, unknown>>(
        `SELECT * FROM bulk_jobs
         WHERE id = $1 AND organization_id = $2`,
        [req.params.id, req.user!.organizationId]
      );

      if (!bulkJob) {
        res.status(404).json({ error: 'Bulk job not found' });
        return;
      }

      // Get per-row status
      const rows = await query<Record<string, unknown>>(
        `SELECT
           cr.id,
           cr.topic,
           cr.status,
           cr.bulk_row_number,
           cr.error_message,
           cr.total_tokens_used,
           cr.platforms,
           (SELECT COUNT(*) FROM artifacts
            WHERE content_request_id = cr.id)::int AS artifact_count
         FROM content_requests cr
         WHERE cr.bulk_job_id = $1
         ORDER BY cr.bulk_row_number ASC`,
        [req.params.id]
      );

      // Compute live counts
      const completed = rows.filter(r =>
        ['awaiting_review', 'approved', 'completed'].includes(r.status as string)
      ).length;

      const failed = rows.filter(r =>
        ['generation_failed', 'failed'].includes(r.status as string)
      ).length;

      const processing = rows.filter(r =>
        ['queued', 'running', 'processing'].includes(r.status as string)
      ).length;

      const totalRows = Number(bulkJob.total_rows) || rows.length;

      const progressPercent = totalRows > 0
        ? Math.round(((completed + failed) / totalRows) * 100)
        : 0;

      // Auto-complete bulk job if all rows done
      if (processing === 0 && (bulkJob.status as string) === 'processing') {
        const newStatus = failed > 0 && completed === 0
          ? 'failed'
          : failed > 0
          ? 'completed_with_errors'
          : 'completed';

        await query(
          `UPDATE bulk_jobs
           SET status = $1,
               completed_count = $2,
               failed_count = $3,
               completed_at = NOW()
           WHERE id = $4`,
          [newStatus, completed, failed, req.params.id]
        );

        bulkJob.status = newStatus;
      }

      res.json({
        bulkJob: {
          ...bulkJob,
          completed_count: completed,
          failed_count:    failed,
          processing_count: processing,
        },
        progress: progressPercent,
        rows,
        isComplete: processing === 0,
      });

    } catch (err) {
      logger.error('GET /bulk/:id error:', { error: err });
      res.status(500).json({ error: 'Failed to fetch bulk job' });
    }
  }
);

// ── GET /api/content/bulk/:id/download ────────────────────────────────────────

bulkRouter.get(
  '/:id/download',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const bulkJob = await queryOne<Record<string, unknown>>(
        `SELECT * FROM bulk_jobs
         WHERE id = $1 AND organization_id = $2`,
        [req.params.id, req.user!.organizationId]
      );

      if (!bulkJob) {
        res.status(404).json({ error: 'Bulk job not found' });
        return;
      }

      // Get all rows with their best artifact
      const rows = await query<Record<string, unknown>>(
        `SELECT
           cr.id,
           cr.topic,
           cr.status,
           cr.bulk_row_number,
           cr.platforms,
           cr.error_message,
           cr.total_tokens_used,
           cr.bulk_row_data,
           (
             SELECT a.content
             FROM artifacts a
             WHERE a.content_request_id = cr.id
               AND a.agent_type IN ('qa_reviewed', 'humanized',
                                    'brand_aligned', 'platform_adapted')
             ORDER BY
               CASE a.agent_type
                 WHEN 'qa_reviewed'     THEN 1
                 WHEN 'humanized'       THEN 2
                 WHEN 'brand_aligned'   THEN 3
                 WHEN 'platform_adapted' THEN 4
                 ELSE 5
               END
             LIMIT 1
           ) AS best_content,
           (
             SELECT (a.quality_score->>'overall')::numeric
             FROM artifacts a
             WHERE a.content_request_id = cr.id
               AND a.quality_score IS NOT NULL
             LIMIT 1
           ) AS quality_score
         FROM content_requests cr
         WHERE cr.bulk_job_id = $1
         ORDER BY cr.bulk_row_number ASC`,
        [req.params.id]
      );

      // Build Excel workbook
      const workbook  = XLSX.utils.book_new();

      // Sheet 1: Results
      const resultData = rows.map((row: any) => {
        const rowData = row.bulk_row_data
          ? (typeof row.bulk_row_data === 'string'
              ? JSON.parse(row.bulk_row_data)
              : row.bulk_row_data)
          : {};

        return {
          'Row #':              row.bulk_row_number,
          'Topic':              row.topic,
          'Status':             row.status,
          'Platforms':          typeof row.platforms === 'string' ? row.platforms : JSON.stringify(row.platforms),
          'Quality Score':      row.quality_score ?? 'N/A',
          'Tokens Used':        row.total_tokens_used ?? 0,
          'Generated Content':  row.best_content ?? 'Generation failed',
          'Error':              row.error_message ?? '',
          'Original Objective': rowData.objective ?? '',
          'Original Structure': rowData.writing_structure ?? '',
          'Original Language':  rowData.language ?? '',
          'Request ID':         row.id,
        };
      });

      const resultsSheet = XLSX.utils.json_to_sheet(resultData);

      // Set column widths
      resultsSheet['!cols'] = [
        { wch: 6  },  // Row #
        { wch: 50 },  // Topic
        { wch: 15 },  // Status
        { wch: 30 },  // Platforms
        { wch: 13 },  // Quality Score
        { wch: 12 },  // Tokens Used
        { wch: 80 },  // Generated Content (wide!)
        { wch: 40 },  // Error
        { wch: 25 },  // Objective
        { wch: 20 },  // Structure
        { wch: 12 },  // Language
        { wch: 36 },  // Request ID
      ];

      XLSX.utils.book_append_sheet(workbook, resultsSheet, 'Generated Content');

      // Sheet 2: Summary
      const completed = rows.filter((r: any) =>
        ['awaiting_review', 'approved', 'completed'].includes(r.status)
      ).length;

      const failed = rows.filter((r: any) =>
        ['generation_failed', 'failed'].includes(r.status)
      ).length;

      const scoredRows = rows.filter((r: any) => r.quality_score);
      const avgScore = scoredRows.length > 0
        ? scoredRows.reduce((sum: number, r: any) => sum + Number(r.quality_score), 0) / scoredRows.length
        : 0;

      const summaryData = [
        { Metric: 'Total Rows',        Value: rows.length },
        { Metric: 'Successfully Done', Value: completed   },
        { Metric: 'Failed',            Value: failed      },
        { Metric: 'Avg Quality Score', Value: Math.round(avgScore) || 'N/A' },
        { Metric: 'Bulk Job ID',       Value: req.params.id },
        { Metric: 'Generated At',      Value: new Date().toISOString() },
      ];

      const summarySheet = XLSX.utils.json_to_sheet(summaryData);
      summarySheet['!cols'] = [{ wch: 25 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

      // Generate buffer
      const buffer = XLSX.write(workbook, {
        type:      'buffer',
        bookType:  'xlsx',
      });

      const filename = `mcap-bulk-results-${req.params.id.slice(0, 8)}.xlsx`;

      res.setHeader('Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition',
        `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);

      res.send(buffer);

    } catch (err) {
      logger.error('GET /bulk/:id/download error:', { error: err });
      res.status(500).json({ error: 'Failed to generate download' });
    }
  }
);

export default bulkRouter;
