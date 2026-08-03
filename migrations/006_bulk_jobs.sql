-- Migration 006: Bulk Jobs Table and Content Requests Tracking Columns

-- Create bulk_jobs table
CREATE TABLE IF NOT EXISTS bulk_jobs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id   UUID REFERENCES organizations(id)
                    ON DELETE CASCADE NOT NULL,
  created_by        UUID REFERENCES users(id),

  -- File metadata
  original_filename VARCHAR(500),
  total_rows        INTEGER NOT NULL DEFAULT 0,

  -- Progress tracking
  status            VARCHAR(50) DEFAULT 'processing',
  -- processing | completed | completed_with_errors | failed

  queued_count      INTEGER DEFAULT 0,
  processing_count  INTEGER DEFAULT 0,
  completed_count   INTEGER DEFAULT 0,
  failed_count      INTEGER DEFAULT 0,

  -- Timing
  started_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at      TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast polling
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_org
  ON bulk_jobs(organization_id);

CREATE INDEX IF NOT EXISTS idx_bulk_jobs_status
  ON bulk_jobs(status);

-- Modify content_requests table to add bulk tracking columns
ALTER TABLE content_requests
  ADD COLUMN IF NOT EXISTS bulk_job_id UUID
    REFERENCES bulk_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bulk_row_number INTEGER,
  ADD COLUMN IF NOT EXISTS bulk_row_data JSONB;

-- Index for bulk job queries
CREATE INDEX IF NOT EXISTS idx_content_requests_bulk_job
  ON content_requests(bulk_job_id);
