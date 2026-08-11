-- migrations/007_content_actions.sql
-- Adds: edit history, refinement tracking, rejection workflow

-- ═══════════════════════════════════════════════════════════
-- 1. Version History Table
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS content_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_request_id UUID NOT NULL REFERENCES content_requests(id) ON DELETE CASCADE,
    artifact_id UUID REFERENCES artifacts(id) ON DELETE SET NULL,
    
    version_number INT NOT NULL,
    platform VARCHAR(50),
    content TEXT NOT NULL,
    
    -- What changed
    change_type VARCHAR(30) NOT NULL, -- 'generated' | 'edited' | 'refined' | 'regenerated'
    change_summary TEXT,
    user_prompt TEXT,                 -- User's refinement request
    quick_tags JSONB DEFAULT '[]',    -- Quick improvement tags used
    
    -- Metadata
    tokens_used INT DEFAULT 0,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Diff tracking
    previous_version_id UUID REFERENCES content_versions(id) ON DELETE SET NULL,
    char_diff INT,  -- Character difference from previous
    
    CONSTRAINT valid_change_type CHECK (
        change_type IN ('generated', 'edited', 'refined', 'regenerated', 'humanized')
    )
);

CREATE INDEX IF NOT EXISTS idx_versions_request ON content_versions(content_request_id);
CREATE INDEX IF NOT EXISTS idx_versions_artifact ON content_versions(artifact_id);
CREATE INDEX IF NOT EXISTS idx_versions_created ON content_versions(created_at DESC);

-- ═══════════════════════════════════════════════════════════
-- 2. Extend artifacts with editing fields
-- ═══════════════════════════════════════════════════════════
ALTER TABLE artifacts 
    ADD COLUMN IF NOT EXISTS edited_content TEXT,
    ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS refinement_count INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS current_version_id UUID REFERENCES content_versions(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════
-- 3. Extend content_requests with review fields
-- ═══════════════════════════════════════════════════════════
ALTER TABLE content_requests 
    ADD COLUMN IF NOT EXISTS approval_notes TEXT,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS total_refinements INT DEFAULT 0;

-- ═══════════════════════════════════════════════════════════
-- 4. Helpful views
-- ═══════════════════════════════════════════════════════════

-- Latest version per artifact
CREATE OR REPLACE VIEW artifact_latest_content AS
SELECT DISTINCT ON (a.id)
    a.id as artifact_id,
    a.content_request_id,
    COALESCE(cv.content, a.edited_content, a.content) as current_content,
    COALESCE(cv.version_number, 1) as current_version,
    a.refinement_count,
    a.last_edited_at,
    cv.change_type as last_change_type
FROM artifacts a
LEFT JOIN content_versions cv ON cv.id = a.current_version_id
ORDER BY a.id, cv.created_at DESC NULLS LAST;

-- Version history with user info
CREATE OR REPLACE VIEW content_version_history AS
SELECT 
    cv.*,
    u.name as created_by_name,
    u.email as created_by_email
FROM content_versions cv
LEFT JOIN users u ON u.id = cv.created_by;

-- ═══════════════════════════════════════════════════════════
-- 5. Trigger: Auto-create version on artifact insert
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION create_initial_version()
RETURNS TRIGGER AS $$
DECLARE
    v_platform TEXT;
    v_user_id UUID;
BEGIN
    -- Extract platform from metadata
    v_platform := COALESCE(
        (NEW.metadata->>'platform')::TEXT,
        NEW.agent_type
    );
    
    -- Get user from content_request
    SELECT created_by INTO v_user_id 
    FROM content_requests 
    WHERE id = NEW.content_request_id;
    
    -- Create initial version
    IF v_user_id IS NOT NULL THEN
        INSERT INTO content_versions (
            content_request_id, artifact_id, version_number,
            platform, content, change_type, created_by
        ) VALUES (
            NEW.content_request_id, NEW.id, 1,
            v_platform, NEW.content, 'generated', v_user_id
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_artifact_initial_version ON artifacts;
CREATE TRIGGER trg_artifact_initial_version
    AFTER INSERT ON artifacts
    FOR EACH ROW
    EXECUTE FUNCTION create_initial_version();

-- ═══════════════════════════════════════════════════════════
-- Done
-- ═══════════════════════════════════════════════════════════
