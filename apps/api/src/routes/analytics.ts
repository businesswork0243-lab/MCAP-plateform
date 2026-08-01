import { Router, Response } from 'express';
import { getPool } from '../db/connection';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { logger } from '../lib/logger';

const router = Router();
router.use(authenticate);
export default router;

// ─── Types ────────────────────────────────────────────────────────────────────

interface OverviewStats {
  total_requests:           string;
  approved:                 string;
  awaiting_review:          string;
  generation_failed:        string;
  published:                string;
  avg_completion_seconds:   string | null;
}

interface AgentStats {
  total_executions: string;
  completed:        string;
  failed:           string;
  avg_tokens:       string | null;
  total_tokens:     string | null;
}

// ─── Helper: Parse days param safely ─────────────────────────────────────────

function parseDays(raw: unknown, defaultVal = 30, max = 365): number {
  const n = parseInt(String(raw ?? defaultVal), 10);
  if (isNaN(n) || n < 1) return defaultVal;
  return Math.min(n, max); // Cap at max to prevent abuse
}

// ─── GET /api/analytics/overview ─────────────────────────────────────────────

router.get('/overview', async (req: AuthenticatedRequest, res: Response) => {
  const pool     = getPool();
  const orgId    = req.user!.organizationId;
  const days     = parseDays(req.query.days);
  const clientId = req.query.clientId;

  const clientFilter = clientId
    ? `AND cr.client_id = $2`
    : '';

  const params: unknown[] = clientId
    ? [orgId, clientId]
    : [orgId];

  try {
    const [contentResult, agentResult, tokenResult] = await Promise.all([

      // Content request stats
      pool.query<OverviewStats>(
        `SELECT
          COUNT(*)                                                     AS total_requests,
          COUNT(*) FILTER (WHERE status = 'approved')                 AS approved,
          COUNT(*) FILTER (WHERE status = 'awaiting_review')          AS awaiting_review,
          COUNT(*) FILTER (WHERE status = 'generation_failed')        AS generation_failed,
          COUNT(*) FILTER (WHERE status = 'published')                AS published,
          ROUND(AVG(
            EXTRACT(EPOCH FROM (updated_at - created_at))
          ))                                                           AS avg_completion_seconds
        FROM content_requests cr
        WHERE cr.organization_id = $1 ${clientFilter}
          AND cr.created_at >= NOW() - INTERVAL '1 day' * $${params.length + 1}`,
        [...params, days]
      ),

      // Agent execution stats
      pool.query<AgentStats>(
        `SELECT
          COUNT(ae.id)                                                  AS total_executions,
          COUNT(ae.id) FILTER (WHERE ae.status = 'completed')          AS completed,
          COUNT(ae.id) FILTER (WHERE ae.status = 'failed')             AS failed,
          ROUND(AVG(ae.tokens_used))                                    AS avg_tokens,
          SUM(ae.tokens_used)                                           AS total_tokens
        FROM agent_executions ae
        JOIN content_requests cr ON ae.request_id = cr.id
        WHERE cr.organization_id = $1 ${clientFilter}
          AND ae.created_at >= NOW() - INTERVAL '1 day' * $${params.length + 1}`,
        [...params, days]
      ),

      // Token usage by day (last 7 days)
      pool.query(
        `SELECT
          DATE_TRUNC('day', ae.created_at)::date AS day,
          SUM(ae.tokens_used)                     AS tokens
        FROM agent_executions ae
        JOIN content_requests cr ON ae.request_id = cr.id
        WHERE cr.organization_id = $1 ${clientFilter}
          AND ae.created_at >= NOW() - INTERVAL '7 days'
        GROUP BY day
        ORDER BY day ASC`,
        params
      ),
    ]);

    res.json({
      period:     `${days}d`,
      content:    contentResult.rows[0],
      agents:     agentResult.rows[0],
      tokenTrend: tokenResult.rows,
    });

  } catch (err) {
    logger.error('GET /analytics/overview error:', { error: err, orgId });
    res.status(500).json({ error: 'Failed to fetch analytics overview' });
  }
});

// ─── GET /api/analytics/productivity ─────────────────────────────────────────

router.get('/productivity', async (req: AuthenticatedRequest, res: Response) => {
  const pool  = getPool();
  const orgId = req.user!.organizationId;
  const days  = parseDays(req.query.days, 30, 90);

  try {
    const result = await pool.query(
      `SELECT
        DATE_TRUNC('day', created_at)::date                            AS day,
        COUNT(*)                                                        AS requests_created,
        COUNT(*) FILTER (WHERE status IN ('approved', 'published'))     AS completed,
        COUNT(*) FILTER (WHERE status = 'generation_failed')            AS failed
       FROM content_requests
       WHERE organization_id = $1
         AND created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY day
       ORDER BY day ASC`,
      [orgId, days]
    );

    // Fill missing days with zeros for chart continuity
    const filled = fillMissingDays(result.rows, days);

    res.json({ days, data: filled });

  } catch (err) {
    logger.error('GET /analytics/productivity error:', { error: err, orgId });
    res.status(500).json({ error: 'Failed to fetch productivity metrics' });
  }
});

// ─── GET /api/analytics/quality ──────────────────────────────────────────────

router.get('/quality', async (req: AuthenticatedRequest, res: Response) => {
  const pool  = getPool();
  const orgId = req.user!.organizationId;
  const days  = parseDays(req.query.days);

  try {
    // Scores are stored in artifacts.quality_score JSONB
    // Schema: { overall, brand, readability, platform_fit, humanization, clarity, engagement, cta, structure, consistency }
    const result = await pool.query(
      `SELECT
        ROUND(AVG((a.quality_score->>'overall')::numeric),      1) AS avg_overall,
        ROUND(AVG((a.quality_score->>'brand')::numeric),         1) AS avg_brand,
        ROUND(AVG((a.quality_score->>'readability')::numeric),   1) AS avg_readability,
        ROUND(AVG((a.quality_score->>'platform_fit')::numeric),  1) AS avg_platform_fit,
        ROUND(AVG((a.quality_score->>'humanization')::numeric),  1) AS avg_humanization,
        ROUND(AVG((a.quality_score->>'clarity')::numeric),       1) AS avg_clarity,
        ROUND(AVG((a.quality_score->>'engagement')::numeric),    1) AS avg_engagement,
        ROUND(AVG((a.quality_score->>'cta')::numeric),           1) AS avg_cta,
        ROUND(AVG((a.quality_score->>'structure')::numeric),     1) AS avg_structure,
        COUNT(a.id) FILTER (WHERE (a.quality_score->>'overall')::numeric >= 80) AS high_quality_count,
        COUNT(a.id)                                                  AS total_scored
       FROM artifacts a
       JOIN content_requests cr ON a.request_id = cr.id
       WHERE cr.organization_id = $1
         AND a.created_at >= NOW() - INTERVAL '1 day' * $2
         AND a.quality_score IS NOT NULL
         AND a.quality_score != 'null'::jsonb`,
      [orgId, days]
    );

    // Score over time (last 14 days)
    const trend = await pool.query(
      `SELECT
        DATE_TRUNC('day', a.created_at)::date                        AS day,
        ROUND(AVG((a.quality_score->>'overall')::numeric), 1)        AS avg_score,
        COUNT(a.id)                                                   AS count
       FROM artifacts a
       JOIN content_requests cr ON a.request_id = cr.id
       WHERE cr.organization_id = $1
         AND a.created_at >= NOW() - INTERVAL '14 days'
         AND a.quality_score IS NOT NULL
       GROUP BY day
       ORDER BY day ASC`,
      [orgId]
    );

    res.json({
      scores: result.rows[0],
      trend:  trend.rows,
    });

  } catch (err) {
    logger.error('GET /analytics/quality error:', { error: err, orgId });
    res.status(500).json({ error: 'Failed to fetch quality metrics' });
  }
});

// ─── GET /api/analytics/platforms ────────────────────────────────────────────

router.get('/platforms', async (req: AuthenticatedRequest, res: Response) => {
  const pool  = getPool();
  const orgId = req.user!.organizationId;
  const days  = parseDays(req.query.days);

  try {
    // platforms is JSONB array — unnest it
    const result = await pool.query(
      `SELECT
        platform_val                                                    AS platform,
        COUNT(*)                                                        AS count,
        COUNT(*) FILTER (WHERE cr.status = 'published')                AS published,
        ROUND(
          AVG((a.quality_score->>'overall')::numeric), 1
        )                                                               AS avg_score
       FROM content_requests cr,
            jsonb_array_elements_text(cr.platforms) AS platform_val
       LEFT JOIN artifacts a
         ON a.request_id = cr.id
        AND a.platform = platform_val
       WHERE cr.organization_id = $1
         AND cr.created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY platform_val
       ORDER BY count DESC
       LIMIT 10`,
      [orgId, days]
    );

    res.json({ platforms: result.rows, days });

  } catch (err) {
    logger.error('GET /analytics/platforms error:', { error: err, orgId });
    res.status(500).json({ error: 'Failed to fetch platform metrics' });
  }
});

// ─── GET /api/analytics/team-activity ────────────────────────────────────────

router.get('/team-activity', async (req: AuthenticatedRequest, res: Response) => {
  const pool  = getPool();
  const orgId = req.user!.organizationId;
  const days  = parseDays(req.query.days);

  try {
    const result = await pool.query(
      `SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        COUNT(cr.id)                                                   AS requests_created,
        COUNT(cr.id) FILTER (WHERE cr.status = 'approved')             AS approved,
        COUNT(cr.id) FILTER (WHERE cr.status = 'generation_failed')    AS failed,
        SUM(ae.tokens_used)                                             AS tokens_used
       FROM users u
       LEFT JOIN content_requests cr
         ON cr.created_by = u.id
        AND cr.created_at >= NOW() - INTERVAL '1 day' * $2
       LEFT JOIN agent_executions ae
         ON ae.request_id = cr.id
       WHERE u.organization_id = $1
         AND u.status = 'active'
       GROUP BY u.id, u.name, u.email, u.role
       ORDER BY requests_created DESC`,
      [orgId, days]
    );

    res.json({ team: result.rows, days });

  } catch (err) {
    logger.error('GET /analytics/team-activity error:', { error: err, orgId });
    res.status(500).json({ error: 'Failed to fetch team activity' });
  }
});

// ─── GET /api/analytics/writing-structures ────────────────────────────────────

router.get('/writing-structures', async (req: AuthenticatedRequest, res: Response) => {
  const pool  = getPool();
  const orgId = req.user!.organizationId;
  const days  = parseDays(req.query.days);

  try {
    const result = await pool.query(
      `SELECT
        COALESCE(cr.writing_structure, 'unspecified')                  AS structure,
        COUNT(cr.id)                                                    AS count,
        ROUND(AVG((a.quality_score->>'overall')::numeric), 1)          AS avg_score
       FROM content_requests cr
       LEFT JOIN artifacts a ON a.request_id = cr.id
       WHERE cr.organization_id = $1
         AND cr.created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY cr.writing_structure
       ORDER BY count DESC`,
      [orgId, days]
    );

    res.json({ structures: result.rows });

  } catch (err) {
    logger.error('GET /analytics/writing-structures error:', { error: err, orgId });
    res.status(500).json({ error: 'Failed to fetch structure metrics' });
  }
});

// ─── Utility: Fill missing days with zeros ────────────────────────────────────

function fillMissingDays(
  rows: Array<{ day: string; requests_created: string; completed: string; failed: string }>,
  days: number
): Array<{ day: string; requests_created: number; completed: number; failed: number }> {
  // Convert map key to simple date strings (without timezones)
  const map = new Map(rows.map(r => {
    const dStr = typeof r.day === 'string' ? r.day : new Date(r.day).toISOString().slice(0, 10);
    return [dStr, r];
  }));
  const result: Array<{ day: string; requests_created: number; completed: number; failed: number }> = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const row = map.get(key);

    result.push({
      day:               key,
      requests_created:  row ? parseInt(row.requests_created) : 0,
      completed:         row ? parseInt(row.completed) : 0,
      failed:            row ? parseInt(row.failed) : 0,
    });
  }

  return result;
}
