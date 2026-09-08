// apps/api/src/jobs/workers/quality-score.ts
//
// The QA agent returns camelCase dimension names; artifacts.quality_score and
// the analytics queries use snake_case ones. Nothing ever wrote that column,
// so every quality figure on the analytics page averaged over an empty set
// and came out as zero.
//
// Kept out of contentWorker.ts so it can be tested without importing the
// queue, which opens a Redis connection at module load.

/** Column names analytics.ts reads with `quality_score->>'...'`. */
const DIMENSIONS: ReadonlyArray<readonly [string, string]> = [
  ['overall',      'overallScore'],
  ['brand',        'brandScore'],
  ['readability',  'readabilityScore'],
  ['platform_fit', 'platformScore'],
  ['humanization', 'humanizationScore'],
  ['clarity',      'clarityScore'],
  ['engagement',   'engagementScore'],
  ['cta',          'ctaScore'],
  ['structure',    'structureScore'],
  ['consistency',  'consistencyScore'],
  ['grounding',    'groundingScore'],
]

export function toQualityScore(
  qa: Record<string, unknown> | null | undefined
): Record<string, number> | null {
  if (!qa || typeof qa !== 'object') return null

  const mapped: Record<string, number> = {}

  for (const [column, source] of DIMENSIONS) {
    const value = (qa as Record<string, unknown>)[source]
    if (typeof value === 'number' && Number.isFinite(value)) {
      mapped[column] = value
    }
  }

  return Object.keys(mapped).length > 0 ? mapped : null
}
