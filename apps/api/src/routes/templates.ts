// apps/api/src/routes/templates.ts
//
// The templates table and the Templates page both existed, but no route ever
// connected them: the page's "My" and "Team" tabs called GET /api/templates
// and got a 404 from an endpoint that was never written.

import { Router, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { query, queryOne } from '../db/connection'
import { authenticate, AuthenticatedRequest } from '../middleware/auth'
import { logger } from '../lib/logger'

const router = Router()
router.use(authenticate)
export default router

const VISIBILITY = ['personal', 'team', 'public'] as const

const templateSchema = z.object({
  name:              z.string().min(1).max(255).trim(),
  description:       z.string().max(2000).optional(),
  visibility:        z.enum(VISIBILITY).default('personal'),
  // The full content-request configuration, replayed into the wizard later.
  config:            z.record(z.unknown()).default({}),
  platforms:         z.array(z.string()).default([]),
  writing_structure: z.string().max(100).optional(),
  industry_tags:     z.array(z.string()).default([]),
})

// GET /api/templates
// Returns the caller's own templates plus anything their organization shares.
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { visibility } = req.query

    const rows = await query(
      `SELECT t.*, u.name AS created_by_name
       FROM templates t
       LEFT JOIN users u ON u.id = t.created_by
       WHERE t.organization_id = $1
         AND (t.created_by = $2 OR t.visibility IN ('team', 'public'))
         AND ($3::varchar IS NULL OR t.visibility = $3)
       ORDER BY t.use_count DESC, t.created_at DESC`,
      [
        req.user!.organizationId,
        req.user!.id,
        typeof visibility === 'string' && VISIBILITY.includes(visibility as any)
          ? visibility
          : null,
      ]
    )

    res.json({ templates: rows })
  } catch (err) {
    logger.error('GET /templates error:', { error: err })
    res.status(500).json({ error: 'Failed to fetch templates' })
  }
})

// GET /api/templates/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const template = await queryOne(
      `SELECT t.*, u.name AS created_by_name
       FROM templates t
       LEFT JOIN users u ON u.id = t.created_by
       WHERE t.id = $1
         AND t.organization_id = $2
         AND (t.created_by = $3 OR t.visibility IN ('team', 'public'))`,
      [req.params.id, req.user!.organizationId, req.user!.id]
    )
    if (!template) { res.status(404).json({ error: 'Template not found' }); return }
    res.json(template)
  } catch (err) {
    logger.error('GET /templates/:id error:', { error: err })
    res.status(500).json({ error: 'Failed to fetch template' })
  }
})

// POST /api/templates
router.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parsed = templateSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors })
      return
    }
    const d = parsed.data
    const id = uuidv4()

    await query(
      `INSERT INTO templates (
        id, organization_id, created_by,
        name, description, visibility,
        config, platforms, writing_structure, industry_tags
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        req.user!.organizationId,
        req.user!.id,
        d.name,
        d.description ?? null,
        d.visibility,
        JSON.stringify(d.config),
        JSON.stringify(d.platforms),
        d.writing_structure ?? null,
        JSON.stringify(d.industry_tags),
      ]
    )

    const template = await queryOne('SELECT * FROM templates WHERE id = $1', [id])
    res.status(201).json(template)
  } catch (err) {
    logger.error('POST /templates error:', { error: err })
    res.status(500).json({ error: 'Failed to create template' })
  }
})

// PATCH /api/templates/:id — only the author can edit
router.patch('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const parsed = templateSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors })
      return
    }
    const d = parsed.data

    const owned = await queryOne(
      'SELECT id FROM templates WHERE id = $1 AND organization_id = $2 AND created_by = $3',
      [req.params.id, req.user!.organizationId, req.user!.id]
    )
    if (!owned) {
      res.status(404).json({ error: 'Template not found, or not yours to edit' })
      return
    }

    const sets: string[] = []
    const vals: unknown[] = []
    let i = 1

    const columns: Array<[keyof typeof d, string, boolean]> = [
      ['name',              'name',              false],
      ['description',       'description',       false],
      ['visibility',        'visibility',        false],
      ['writing_structure', 'writing_structure', false],
      ['config',            'config',            true],
      ['platforms',         'platforms',         true],
      ['industry_tags',     'industry_tags',     true],
    ]

    for (const [key, column, isJson] of columns) {
      if (d[key] !== undefined) {
        sets.push(`${column} = $${i++}`)
        vals.push(isJson ? JSON.stringify(d[key]) : d[key])
      }
    }

    if (sets.length === 0) {
      res.status(400).json({ error: 'Nothing to update' })
      return
    }

    sets.push('updated_at = NOW()')
    vals.push(req.params.id)

    await query(`UPDATE templates SET ${sets.join(', ')} WHERE id = $${i}`, vals)

    const template = await queryOne('SELECT * FROM templates WHERE id = $1', [req.params.id])
    res.json(template)
  } catch (err) {
    logger.error('PATCH /templates/:id error:', { error: err })
    res.status(500).json({ error: 'Failed to update template' })
  }
})

// POST /api/templates/:id/use — record that a template was applied
router.post('/:id/use', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const template = await queryOne<{ id: string; config: unknown }>(
      `SELECT id, config FROM templates
       WHERE id = $1 AND organization_id = $2
         AND (created_by = $3 OR visibility IN ('team', 'public'))`,
      [req.params.id, req.user!.organizationId, req.user!.id]
    )
    if (!template) { res.status(404).json({ error: 'Template not found' }); return }

    await query(
      'UPDATE templates SET use_count = use_count + 1 WHERE id = $1',
      [req.params.id]
    )

    res.json({ config: template.config })
  } catch (err) {
    logger.error('POST /templates/:id/use error:', { error: err })
    res.status(500).json({ error: 'Failed to apply template' })
  }
})

// DELETE /api/templates/:id — only the author can delete
router.delete('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await query(
      'DELETE FROM templates WHERE id = $1 AND organization_id = $2 AND created_by = $3 RETURNING id',
      [req.params.id, req.user!.organizationId, req.user!.id]
    )
    if (result.length === 0) {
      res.status(404).json({ error: 'Template not found, or not yours to delete' })
      return
    }
    res.json({ message: 'Template deleted' })
  } catch (err) {
    logger.error('DELETE /templates/:id error:', { error: err })
    res.status(500).json({ error: 'Failed to delete template' })
  }
})
