-- migrations/009_backfill_quality_score.sql
-- =============================================
-- artifacts.quality_score was never written by any code path, while the
-- analytics quality endpoint averages over exactly that column — so every
-- quality figure on the analytics page came back as zero.
--
-- The scores were being stored all along, one level deeper, inside
-- metadata.qa. This recovers them for existing rows so historical analytics
-- are not blank. New artifacts write the column directly.
-- =============================================

UPDATE artifacts
SET quality_score = jsonb_strip_nulls(
  jsonb_build_object(
    'overall',      COALESCE(metadata->'qa'->'overallScore', metadata->'overallScore'),
    'brand',        metadata->'qa'->'brandScore',
    'readability',  metadata->'qa'->'readabilityScore',
    'platform_fit', metadata->'qa'->'platformScore',
    'humanization', metadata->'qa'->'humanizationScore',
    'clarity',      metadata->'qa'->'clarityScore',
    'engagement',   metadata->'qa'->'engagementScore',
    'cta',          metadata->'qa'->'ctaScore',
    'structure',    metadata->'qa'->'structureScore',
    'consistency',  metadata->'qa'->'consistencyScore',
    'grounding',    metadata->'qa'->'groundingScore'
  )
)
WHERE quality_score IS NULL
  AND jsonb_typeof(metadata) = 'object'
  AND (metadata ? 'qa' OR metadata ? 'overallScore');

-- Rows whose metadata carried nothing usable end up with '{}'; treat those
-- as unscored so the analytics filter keeps skipping them.
UPDATE artifacts
SET quality_score = NULL
WHERE quality_score = '{}'::jsonb;

DO $$
BEGIN
  RAISE NOTICE 'Migration 009: quality_score backfilled from metadata.qa';
END $$;
