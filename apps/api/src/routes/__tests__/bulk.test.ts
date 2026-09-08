import { describe, it, expect } from 'vitest'
import { bulkRowSchema, parsePlatforms } from '../bulk.schema'

// Spreadsheets are read with `raw: false` and `defval: ''`, so every cell
// arrives as a string and a blank cell arrives as '' rather than undefined.
// That is what broke bulk upload in production: `.optional().default()` only
// fires for undefined, so a blank humanization_level invalidated the whole
// row and a file of otherwise-valid rows produced nothing.
const asSheetRow = (over: Record<string, string> = {}) => ({
  topic: 'Why most startups fail at content marketing',
  objective: '',
  context: '',
  platforms: 'linkedin_post',
  writing_structure: '',
  perspective: '',
  language: '',
  cta_type: '',
  keywords: '',
  tone_excited: '',
  tone_confident: '',
  tone_curious: '',
  tone_serious: '',
  humanization_level: '',
  word_count: '',
  special_instructions: '',
  brand_profile_name: '',
  icp_name: '',
  custom_audience: '',
  enable_qa: '',
  seo_enabled: '',
  seo_primary_keyword: '',
  ...over,
})

describe('bulkRowSchema', () => {
  it('accepts a row where every optional cell is blank', () => {
    const result = bulkRowSchema.safeParse(asSheetRow())
    expect(result.success).toBe(true)
  })

  it('applies real defaults to blank cells instead of zeroing them', () => {
    const parsed = bulkRowSchema.parse(asSheetRow())

    expect(parsed.humanization_level).toBe('medium')
    expect(parsed.objective).toBe('Build thought leadership')
    expect(parsed.writing_structure).toBe('thesis')
    expect(parsed.language).toBe('English')

    // Blank tone cells must fall back to the documented defaults. Coercing
    // '' through Number() yields 0, which silently flattens the tone.
    expect(parsed.tone_excited).toBe(5)
    expect(parsed.tone_confident).toBe(6)
    expect(parsed.tone_curious).toBe(4)
    expect(parsed.tone_serious).toBe(5)

    // A blank word count means "unspecified", not "zero words".
    expect(parsed.word_count).toBeUndefined()
  })

  it("reads the string 'FALSE' as false", () => {
    // z.coerce.boolean() is Boolean(value), so 'FALSE' coerced to true and
    // silently switched SEO on for every row of the shipped template.
    const parsed = bulkRowSchema.parse(
      asSheetRow({ enable_qa: 'FALSE', seo_enabled: 'FALSE' })
    )
    expect(parsed.enable_qa).toBe(false)
    expect(parsed.seo_enabled).toBe(false)
  })

  it('accepts the spellings people actually type for booleans', () => {
    for (const yes of ['TRUE', 'true', 'Yes', 'y', '1']) {
      expect(bulkRowSchema.parse(asSheetRow({ seo_enabled: yes })).seo_enabled).toBe(true)
    }
    for (const no of ['FALSE', 'false', 'No', 'n', '0']) {
      expect(bulkRowSchema.parse(asSheetRow({ seo_enabled: no })).seo_enabled).toBe(false)
    }
  })

  it('accepts humanization_level in any casing', () => {
    expect(bulkRowSchema.parse(asSheetRow({ humanization_level: 'Medium' })).humanization_level)
      .toBe('medium')
    expect(bulkRowSchema.parse(asSheetRow({ humanization_level: ' AGGRESSIVE ' })).humanization_level)
      .toBe('aggressive')
  })

  it('rejects a humanization_level that is not one of the three', () => {
    const result = bulkRowSchema.safeParse(asSheetRow({ humanization_level: 'extreme' }))
    expect(result.success).toBe(false)
  })

  it('still requires a topic and at least one platform', () => {
    expect(bulkRowSchema.safeParse(asSheetRow({ topic: 'ab' })).success).toBe(false)
    expect(bulkRowSchema.safeParse(asSheetRow({ platforms: '' })).success).toBe(false)
    expect(bulkRowSchema.safeParse(asSheetRow({ platforms: '   ' })).success).toBe(false)
  })

  it('keeps an explicit numeric word count', () => {
    expect(bulkRowSchema.parse(asSheetRow({ word_count: '800' })).word_count).toBe(800)
  })
})

describe('parsePlatforms', () => {
  it('normalises the platform names a person would type', () => {
    expect(parsePlatforms('LinkedIn Post, X Thread')).toEqual(['linkedin_post', 'x_thread'])
    expect(parsePlatforms('linkedin-post')).toEqual(['linkedin_post'])
    expect(parsePlatforms('  Newsletter  ')).toEqual(['newsletter'])
  })

  it('drops empty segments from trailing or doubled commas', () => {
    expect(parsePlatforms('linkedin_post,,newsletter,')).toEqual(['linkedin_post', 'newsletter'])
  })

  it('produces the same value used for storage and for the queued job', () => {
    // These disagreed before: the row was stored with the raw casing while
    // the job was queued lowercased, so the record did not match the output.
    const row = bulkRowSchema.parse(asSheetRow({ platforms: 'LinkedIn Post' }))
    expect(parsePlatforms(row.platforms)).toEqual(['linkedin_post'])
  })
})
