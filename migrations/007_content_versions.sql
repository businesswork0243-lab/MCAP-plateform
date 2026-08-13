-- migrations/007_content_versions.sql
-- Content History + Artifact Edit Tracking

-- ── 1. Artifacts missing columns ─────────────────────────────────────────────

ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS content_request_id UUID
    REFERENCES content_requests(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS agent_type         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS edited_content     TEXT,
  ADD COLUMN IF NOT EXISTS last_edited_by     UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS last_edited_at     TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS refinement_count   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_version_id UUID;

-- Backfill
UPDATE artifacts
SET content_request_id = request_id
WHERE content_request_id IS NULL AND request_id IS NOT NULL;

UPDATE artifacts
SET agent_type = content_type
WHERE agent_type IS NULL AND content_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_artifacts_content_request
  ON artifacts(content_request_id);

CREATE INDEX IF NOT EXISTS idx_artifacts_agent_type
  ON artifacts(agent_type);

-- ── 2. Content Versions table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_versions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_request_id  UUID NOT NULL
    REFERENCES content_requests(id) ON DELETE CASCADE,
  artifact_id         UUID NOT NULL
    REFERENCES artifacts(id) ON DELETE CASCADE,

  version_number      INTEGER NOT NULL,
  platform            VARCHAR(100),
  content             TEXT NOT NULL,

  change_type         VARCHAR(50) NOT NULL DEFAULT 'generated',
  -- generated | edited | refined | regenerated | humanized | restored

  change_summary      VARCHAR(500),
  user_prompt         TEXT,
  quick_tags          JSONB DEFAULT '[]',
  tokens_used         INTEGER DEFAULT 0,
  char_diff           INTEGER DEFAULT 0,

  created_by          UUID REFERENCES users(id),
  previous_version_id UUID REFERENCES content_versions(id),
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_versions_artifact
  ON content_versions(artifact_id);

CREATE INDEX IF NOT EXISTS idx_content_versions_request
  ON content_versions(content_request_id);

CREATE INDEX IF NOT EXISTS idx_content_versions_number
  ON content_versions(artifact_id, version_number DESC);

-- ── 3. Content Requests missing columns ──────────────────────────────────────

ALTER TABLE content_requests
  ADD COLUMN IF NOT EXISTS completed_at          TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS total_tokens_used     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_refinements     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejection_reason      TEXT,
  ADD COLUMN IF NOT EXISTS rejected_by           UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS rejected_at           TIMESTAMP WITH TIME ZONE;

-- ── 4. Agent Executions missing column ───────────────────────────────────────

ALTER TABLE agent_executions
  ADD COLUMN IF NOT EXISTS content_request_id UUID
    REFERENCES content_requests(id) ON DELETE CASCADE;

UPDATE agent_executions
SET content_request_id = request_id
WHERE content_request_id IS NULL AND request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_executions_content_request
  ON agent_executions(content_request_id);

-- ── 5. Auto-create initial version on artifact insert ────────────────────────

CREATE OR REPLACE FUNCTION auto_create_initial_version()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.content IS NOT NULL AND NEW.content != '' THEN
    INSERT INTO content_versions (
      id, content_request_id, artifact_id,
      version_number, platform, content,
      change_type, change_summary, char_diff, created_at
    ) VALUES (
      uuid_generate_v4(),
      NEW.content_request_id,
      NEW.id,
      1,
      COALESCE(NEW.metadata->>'platform', NEW.agent_type, 'canonical'),
      NEW.content,
      'generated',
      'AI Generated — Initial version',
      length(NEW.content),
      NOW()
    )
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_artifact_initial_version ON artifacts;
CREATE TRIGGER trg_artifact_initial_version
  AFTER INSERT ON artifacts
  FOR EACH ROW EXECUTE FUNCTION auto_create_initial_version();
