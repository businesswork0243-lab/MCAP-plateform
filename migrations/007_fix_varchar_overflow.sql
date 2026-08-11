-- migrations/007_fix_varchar_overflow.sql
-- =============================================
-- FIX: VARCHAR overflow errors in content_requests
-- Convert length-limited fields to TEXT / larger VARCHAR
-- =============================================

ALTER TABLE content_requests
  ALTER COLUMN audience              TYPE TEXT,
  ALTER COLUMN writing_structure     TYPE VARCHAR(500),
  ALTER COLUMN narrative_perspective TYPE VARCHAR(500),
  ALTER COLUMN cta_type              TYPE VARCHAR(500),
  ALTER COLUMN reading_level         TYPE VARCHAR(100),
  ALTER COLUMN language              TYPE VARCHAR(50);

-- target_platform can be a long platform name
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='content_requests'
      AND column_name='target_platform'
      AND character_maximum_length IS NOT NULL
      AND character_maximum_length < 200
  ) THEN
    ALTER TABLE content_requests ALTER COLUMN target_platform TYPE VARCHAR(200);
  END IF;
END $$;

-- humanization_level max 20
ALTER TABLE content_requests
  ALTER COLUMN humanization_level TYPE VARCHAR(50);

-- Log successful migration
DO $$
BEGIN
  RAISE NOTICE 'Migration 007: VARCHAR overflow fields expanded';
END $$;
