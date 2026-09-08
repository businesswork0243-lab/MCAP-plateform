// apps/api/src/routes/bulk.schema.ts
//
// Pure parsing rules for an uploaded spreadsheet row. Kept out of bulk.ts so
// they can be tested without importing the queue, which opens a Redis
// connection at module load.

import { z } from 'zod'

// ── Row Schema ────────────────────────────────────────────────────────────────

// Sheets are read with `raw: false` + `defval: ''`, so every cell arrives as a
// string and a blank cell arrives as ''. Plain `.optional().default()` never
// fires for '' — it only fires for `undefined` — so blanks have to be mapped to
// undefined first, otherwise a blank enum cell invalidates the whole row.
const blankToUndefined = (v: unknown): unknown =>
  v === '' || v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v;

const optionalText = (fallback: string) =>
  z.preprocess(blankToUndefined, z.string().optional().default(fallback));

const optionalScore = (fallback: number) =>
  z.preprocess(
    blankToUndefined,
    z.coerce.number().min(0).max(10).optional().default(fallback)
  );

// `z.coerce.boolean()` is Boolean(value), so the string 'FALSE' coerces to true.
// Spreadsheets write TRUE/FALSE/yes/no/1/0, so parse them explicitly.
const optionalBoolean = (fallback: boolean) =>
  z.preprocess((v) => {
    if (blankToUndefined(v) === undefined) return undefined;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(s)) return true;
    if (['false', 'no', 'n', '0'].includes(s)) return false;
    return undefined;
  }, z.boolean().optional().default(fallback));

export const bulkRowSchema = z.object({
  topic:                z.string().min(3).max(500),
  objective:            optionalText('Build thought leadership'),
  context:              optionalText(''),
  platforms:            z.string().trim().min(1),
  writing_structure:    optionalText('thesis'),
  perspective:          optionalText('Founder'),
  language:             optionalText('English'),
  cta_type:             optionalText('comment'),
  keywords:             optionalText(''),
  tone_excited:         optionalScore(5),
  tone_confident:       optionalScore(6),
  tone_curious:         optionalScore(4),
  tone_serious:         optionalScore(5),
  humanization_level:   z.preprocess(
                          (v) => {
                            const t = blankToUndefined(v);
                            return typeof t === 'string' ? t.trim().toLowerCase() : t;
                          },
                          z.enum(['light', 'medium', 'aggressive'])
                            .optional().default('medium')
                        ),
  word_count:           z.preprocess(
                          blankToUndefined,
                          z.coerce.number().int().positive().optional()
                        ),
  special_instructions: optionalText(''),
  brand_profile_name:   optionalText(''),
  icp_name:             optionalText(''),
  custom_audience:      optionalText(''),
  enable_qa:            optionalBoolean(true),
  seo_enabled:          optionalBoolean(false),
  seo_primary_keyword:  optionalText(''),
});

export type BulkRow = z.infer<typeof bulkRowSchema>;

// "LinkedIn Post, X Thread" -> ['linkedin_post', 'x_thread'] — the keys the AI
// engine's PLATFORM_SPECS uses. Applied to both the stored row and the queued
// job so the two never disagree.
export function parsePlatforms(raw: string): string[] {
  return raw
    .split(',')
    .map(p => p.trim().toLowerCase().replace(/[\s-]+/g, '_'))
    .filter(Boolean);
}

// Shared so the stored content_request row and the queued job never disagree.
export function buildTonalitySpectrum(row: BulkRow): Record<string, number> {
  return {
    excited:    row.tone_excited,
    confident:  row.tone_confident,
    curious:    row.tone_curious,
    serious:    row.tone_serious,
    angry:      0,
    frustrated: 0,
    empathetic: 5,
    playful:    3,
  };
}
