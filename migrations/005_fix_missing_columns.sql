-- Migration 005: Fix Missing Columns

-- content_requests: Add missing columns
ALTER TABLE content_requests
  ADD COLUMN IF NOT EXISTS total_tokens_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP WITH TIME ZONE;

-- artifacts: Add compatibility columns
ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS content_request_id UUID,
  ADD COLUMN IF NOT EXISTS agent_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS content TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Sync existing data
UPDATE artifacts SET content_request_id = request_id WHERE content_request_id IS NULL;
UPDATE artifacts SET agent_type = content_type WHERE agent_type IS NULL;
UPDATE artifacts SET content = body WHERE content IS NULL;

-- Add foreign key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'artifacts_content_request_id_fkey'
  ) THEN
    ALTER TABLE artifacts 
      ADD CONSTRAINT artifacts_content_request_id_fkey 
      FOREIGN KEY (content_request_id) REFERENCES content_requests(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_artifacts_content_request 
  ON artifacts(content_request_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_agent_type 
  ON artifacts(agent_type);

-- agent_executions: Add compatibility
ALTER TABLE agent_executions
  ADD COLUMN IF NOT EXISTS content_request_id UUID,
  ADD COLUMN IF NOT EXISTS agent_type VARCHAR(100);

UPDATE agent_executions SET content_request_id = request_id WHERE content_request_id IS NULL;
UPDATE agent_executions SET agent_type = agent_name WHERE agent_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_executions_content_request 
  ON agent_executions(content_request_id);

-- Sync trigger for artifacts
CREATE OR REPLACE FUNCTION sync_artifact_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.content_request_id IS NOT NULL AND NEW.request_id IS NULL THEN
    NEW.request_id := NEW.content_request_id;
  END IF;
  IF NEW.request_id IS NOT NULL AND NEW.content_request_id IS NULL THEN
    NEW.content_request_id := NEW.request_id;
  END IF;
  IF NEW.agent_type IS NOT NULL AND NEW.content_type IS NULL THEN
    NEW.content_type := NEW.agent_type;
  END IF;
  IF NEW.content_type IS NOT NULL AND NEW.agent_type IS NULL THEN
    NEW.agent_type := NEW.content_type;
  END IF;
  IF NEW.content IS NOT NULL AND NEW.body IS NULL THEN
    NEW.body := NEW.content;
  END IF;
  IF NEW.body IS NOT NULL AND NEW.content IS NULL THEN
    NEW.content := NEW.body;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_artifacts_sync ON artifacts;
CREATE TRIGGER trg_artifacts_sync
  BEFORE INSERT OR UPDATE ON artifacts
  FOR EACH ROW EXECUTE FUNCTION sync_artifact_columns();

-- Sync trigger for agent_executions
CREATE OR REPLACE FUNCTION sync_execution_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.content_request_id IS NOT NULL AND NEW.request_id IS NULL THEN
    NEW.request_id := NEW.content_request_id;
  END IF;
  IF NEW.request_id IS NOT NULL AND NEW.content_request_id IS NULL THEN
    NEW.content_request_id := NEW.request_id;
  END IF;
  IF NEW.agent_type IS NOT NULL AND NEW.agent_name IS NULL THEN
    NEW.agent_name := NEW.agent_type;
  END IF;
  IF NEW.agent_name IS NOT NULL AND NEW.agent_type IS NULL THEN
    NEW.agent_type := NEW.agent_name;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_executions_sync ON agent_executions;
CREATE TRIGGER trg_agent_executions_sync
  BEFORE INSERT OR UPDATE ON agent_executions
  FOR EACH ROW EXECUTE FUNCTION sync_execution_columns();

-- IMPORTANT:
-- Do not delete failed content rows in a schema migration.
-- These records are useful for debugging, audit history, and retry visibility.
