import { describe, it, expect } from 'vitest'
import { toQualityScore } from '../quality-score'

// artifacts.quality_score was never written by anything, while the analytics
// quality endpoint averaged over exactly that column — so every figure on the
// analytics page came back as zero. The QA agent returns camelCase names and
// the column uses snake_case ones; this mapping is the bridge.
describe('toQualityScore', () => {
  const qa = {
    overallScore: 91,
    brandScore: 88,
    readabilityScore: 84,
    platformScore: 90,
    humanizationScore: 79,
    clarityScore: 86,
    engagementScore: 75,
    ctaScore: 70,
    structureScore: 82,
    consistencyScore: 87,
    groundingScore: 100,
    flags: ['not a score'],
    summary: 'also not a score',
  }

  it('maps every dimension to the column names analytics queries', () => {
    const out = toQualityScore(qa)!
    // These are the exact keys analytics.ts reads with quality_score->>'...'
    expect(out).toEqual({
      overall: 91,
      brand: 88,
      readability: 84,
      platform_fit: 90,
      humanization: 79,
      clarity: 86,
      engagement: 75,
      cta: 70,
      structure: 82,
      consistency: 87,
      grounding: 100,
    })
  })

  it('drops non-numeric fields rather than writing junk', () => {
    const out = toQualityScore(qa)!
    expect(out).not.toHaveProperty('flags')
    expect(out).not.toHaveProperty('summary')
  })

  it('returns null when there is nothing to record', () => {
    expect(toQualityScore(null)).toBeNull()
    expect(toQualityScore(undefined)).toBeNull()
    expect(toQualityScore({})).toBeNull()
    expect(toQualityScore({ flags: [] })).toBeNull()
  })

  it('keeps a partial result instead of discarding it', () => {
    expect(toQualityScore({ overallScore: 70 })).toEqual({ overall: 70 })
  })

  it('ignores NaN and non-finite values', () => {
    expect(toQualityScore({ overallScore: NaN, brandScore: 80 })).toEqual({ brand: 80 })
  })
})
