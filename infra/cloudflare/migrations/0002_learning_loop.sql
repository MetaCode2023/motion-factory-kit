-- Learning loop: what each video was edited with, how it did on YouTube, how it was rated,
-- and which lessons were tested. Additive only: no existing column or row changes.
-- Nothing reads these tables yet. Design notes: docs/LEARNING.md.

-- A ruleset is one frozen version of the lessons file an edit was made with. Version 0 = no lessons.
CREATE TABLE IF NOT EXISTS rulesets (
  version        INTEGER PRIMARY KEY,
  parent_version INTEGER REFERENCES rulesets(version),
  r2_key         TEXT NOT NULL,                     -- the rendered lessons file
  sha256         TEXT NOT NULL,
  base_rules_sha TEXT NOT NULL,                     -- git sha of the human-written rules it sat beside
  lesson_ids     TEXT NOT NULL DEFAULT '[]',        -- JSON array of lessons.id
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One experiment = current rules (control) against current rules plus 1-2 new lessons (treatment).
CREATE TABLE IF NOT EXISTS experiments (
  id                INTEGER PRIMARY KEY,
  control_ruleset   INTEGER NOT NULL REFERENCES rulesets(version),
  treatment_ruleset INTEGER NOT NULL REFERENCES rulesets(version),
  primary_metric    TEXT NOT NULL,                  -- fixed before any data is read
  target_n_per_arm  INTEGER NOT NULL,
  prereg_r2_key     TEXT NOT NULL,                  -- the written plan, frozen before start
  started_at        TEXT NOT NULL,
  closed_at         TEXT,
  verdict           TEXT CHECK (verdict IN ('treatment_better','control_better','no_difference','inconclusive')),
  p_value           REAL,
  effect            REAL
);

ALTER TABLE outputs ADD COLUMN duration_s       REAL;      -- rendered length
ALTER TABLE outputs ADD COLUMN youtube_video_id TEXT;
ALTER TABLE outputs ADD COLUMN published_at     TEXT;      -- when it went public
ALTER TABLE outputs ADD COLUMN topic            TEXT;
ALTER TABLE outputs ADD COLUMN hook_style       TEXT;
ALTER TABLE outputs ADD COLUMN experiment_id    INTEGER REFERENCES experiments(id);
ALTER TABLE outputs ADD COLUMN arm              TEXT CHECK (arm IN ('control','treatment'));
ALTER TABLE outputs ADD COLUMN assign_seed      INTEGER;   -- the stored seed that split this recording's shorts
ALTER TABLE outputs ADD COLUMN ruleset_version  INTEGER REFERENCES rulesets(version);
ALTER TABLE outputs ADD COLUMN editor_model     TEXT;      -- which model made the edit plan
CREATE UNIQUE INDEX IF NOT EXISTS idx_outputs_youtube ON outputs(youtube_video_id) WHERE youtube_video_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outputs_experiment ON outputs(experiment_id);

-- YouTube Analytics numbers per output at day 3, 7 and 28. The full 100-point curve lives in R2.
CREATE TABLE IF NOT EXISTS metric_snapshots (
  output_id           TEXT NOT NULL REFERENCES outputs(id),
  checkpoint_day      INTEGER NOT NULL CHECK (checkpoint_day IN (3,7,28)),
  window_start        TEXT NOT NULL,
  window_end          TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('provisional','final','withheld')),
  first_fetched_at    TEXT NOT NULL,
  fetched_at          TEXT NOT NULL,
  views               INTEGER,
  engaged_views       INTEGER,
  avg_view_pct        REAL,
  avg_view_duration_s REAL,
  rel_retention_mean  REAL,                         -- mean of the 100 relativeRetentionPerformance points, 0 to 1
  rel_retention_early REAL,                         -- mean of the first 30 points
  hook_retention      REAL,                         -- watch ratio near min(30 s, 25% of duration)
  watch_ratio_max     REAL,                         -- above 1 means loops or rewatching
  curve_r2_key        TEXT,
  PRIMARY KEY (output_id, checkpoint_day)
);

-- Daily impressions and click-through from the YouTube Reporting API reach report.
CREATE TABLE IF NOT EXISTS reach_daily (
  youtube_video_id TEXT NOT NULL,
  date             TEXT NOT NULL,
  impressions      INTEGER,
  ctr_raw          REAL,                            -- units unverified: inspect a real CSV first
  clicks_est       REAL,
  report_id        TEXT NOT NULL,
  raw_r2_key       TEXT,
  PRIMARY KEY (youtube_video_id, date)
);

-- One row per judge, per dimension, per pass. Stored only: ratings steer nothing until validated.
CREATE TABLE IF NOT EXISTS ratings (
  output_id      TEXT NOT NULL REFERENCES outputs(id),
  dimension      TEXT NOT NULL CHECK (dimension IN ('hook','visuals','pacing','overall')),
  rater          TEXT NOT NULL,                     -- 'claude', 'clef-omni', 'owner'
  pass           INTEGER NOT NULL DEFAULT 1,        -- 2 = the self-agreement repeat
  rubric_version INTEGER NOT NULL,
  model          TEXT,
  score          INTEGER CHECK (score BETWEEN 1 AND 5),   -- NULL = unknown or failed call
  probs          TEXT,                              -- JSON: probability per allowed answer (Clef)
  justification  TEXT,
  stop_reason    TEXT,
  rated_at       TEXT NOT NULL,
  PRIMARY KEY (output_id, dimension, rater, rubric_version, pass)
);

CREATE TABLE IF NOT EXISTS lessons (
  id                INTEGER PRIMARY KEY,
  text              TEXT NOT NULL CHECK (length(text) <= 280),
  dimension         TEXT CHECK (dimension IN ('hook','visuals','pacing','other')),
  stage             TEXT NOT NULL CHECK (stage IN ('edit','selection')),
  check_spec        TEXT NOT NULL,                  -- JSON: the test a program runs against the cut
  origin            TEXT NOT NULL CHECK (origin IN ('back_catalog','live')),
  status            TEXT NOT NULL CHECK (status IN ('hypothesis','approved','testing','active','retired')),
  stated_at         TEXT NOT NULL,
  lapses_at         TEXT,
  approved_by       TEXT,                           -- a human, always
  approved_at       TEXT,
  retired_at        TEXT,
  retired_reason    TEXT,
  source_output_ids TEXT NOT NULL DEFAULT '[]'
);

-- Was the lesson in the file for this output, and did the finished cut actually obey it?
CREATE TABLE IF NOT EXISTS lesson_applications (
  lesson_id  INTEGER NOT NULL REFERENCES lessons(id),
  output_id  TEXT NOT NULL REFERENCES outputs(id),
  loaded     INTEGER NOT NULL CHECK (loaded IN (0,1)),
  complied   INTEGER CHECK (complied IN (0,1)),
  checked_at TEXT,
  PRIMARY KEY (lesson_id, output_id)
);

-- Per experiment and arm: how many shorts went public, how many still lack a day-7 result, and the averages.
CREATE VIEW IF NOT EXISTS v_readout AS
SELECT o.experiment_id, o.arm,
       COUNT(*) AS n_published,
       SUM(CASE WHEN m.rel_retention_mean IS NULL THEN 1 ELSE 0 END) AS n_missing,
       AVG(m.rel_retention_mean) AS rel_retention_mean,
       AVG(m.avg_view_pct) AS avg_view_pct
FROM outputs o
LEFT JOIN metric_snapshots m ON m.output_id = o.id AND m.checkpoint_day = 7
WHERE o.kind = 'short' AND o.published_at IS NOT NULL AND o.experiment_id IS NOT NULL
GROUP BY o.experiment_id, o.arm;
