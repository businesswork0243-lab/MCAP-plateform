-- migrations/008_multi_industry.sql
-- =============================================
-- Organizations can operate across several industries, so onboarding
-- collects multiple primary and multiple secondary ones instead of a
-- single value. `industry` is kept in sync with the first primary so
-- existing readers keep working.
-- =============================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS primary_industries   JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS secondary_industries JSONB DEFAULT '[]';

-- Backfill: carry the existing single industry over as the first primary.
UPDATE organizations
SET primary_industries = jsonb_build_array(industry)
WHERE industry IS NOT NULL
  AND btrim(industry) <> ''
  AND COALESCE(primary_industries, '[]'::jsonb) = '[]'::jsonb;

DO $$
BEGIN
  RAISE NOTICE 'Migration 008: multi-industry columns added';
END $$;
