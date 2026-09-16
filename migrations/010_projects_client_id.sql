-- migrations/010_projects_client_id.sql
-- =============================================
-- projects.client_id was never created. Migration 003 added client_id to
-- content_requests and brand_profiles but skipped projects, while
-- routes/projects.ts references it in three places:
--   INSERT INTO projects (... client_id ...)
--   LEFT JOIN clients c ON c.id = p.client_id      (list and detail)
--   UPDATE projects SET client_id = ...
-- So creating a project returned "Request failed with status code 500" and
-- the project list failed the same way.
-- =============================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS client_id UUID;

-- Foreign key added separately so re-running cannot fail on a duplicate.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'projects_client_id_fkey'
      AND table_name = 'projects'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_client
  ON projects(client_id);

DO $$
BEGIN
  RAISE NOTICE 'Migration 010: projects.client_id added';
END $$;
