-- Simulation pipeline: jobs (one per raw recording), outputs (one per long video or short), events (append-only log).
-- Times are ISO-8601 UTC strings. Never DELETE from these tables in normal operation (see AGENTS.md).

CREATE TABLE IF NOT EXISTS jobs (
  id               TEXT PRIMARY KEY,                -- e.g. 2026-11-18-physics-of-poker
  title            TEXT,
  source_filename  TEXT NOT NULL,
  source_bytes     INTEGER NOT NULL,
  duration_s       REAL,
  r2_raw_key       TEXT,
  status           TEXT NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new','ingested','transcribed','planned','built','in_review','approved','posted','failed')),
  claimed_by       TEXT,                            -- agent@machine, e.g. claude-code@atlas-mbp
  lease_expires_at TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  notes            TEXT
);

CREATE TABLE IF NOT EXISTS outputs (
  id             TEXT PRIMARY KEY,                  -- <job_id>/<kind>/<slug>
  job_id         TEXT NOT NULL REFERENCES jobs(id),
  kind           TEXT NOT NULL CHECK (kind IN ('long','short')),
  start_s        REAL NOT NULL,
  end_s          REAL NOT NULL,
  slug           TEXT NOT NULL,
  title          TEXT,
  description    TEXT,
  r2_prefix      TEXT,
  status         TEXT NOT NULL DEFAULT 'proposed'
                 CHECK (status IN ('proposed','built','approved','rejected','posted')),
  platforms      TEXT NOT NULL DEFAULT '[]',        -- JSON array
  posted_urls    TEXT NOT NULL DEFAULT '{}',        -- JSON object: platform -> url
  reviewer_notes TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (job_id, kind, slug)
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     TEXT NOT NULL,
  output_id  TEXT,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '{}',            -- JSON
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_status    ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_outputs_job_id ON outputs(job_id);
CREATE INDEX IF NOT EXISTS idx_events_job_id  ON events(job_id);
-- Same file + size = same recording (ingest skips it).
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source_filename, source_bytes);
