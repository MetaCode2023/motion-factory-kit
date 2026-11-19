-- Each build of an output gets an identity (sha256 of its video.mp4). A rating records the build it rated,
-- so a re-proposed or rebuilt cut never inherits ratings of the old one. Additive only.
ALTER TABLE outputs ADD COLUMN build_id TEXT;   -- set by sim build, cleared by sim propose
ALTER TABLE ratings ADD COLUMN build_id TEXT;   -- current iff = outputs.build_id
CREATE INDEX IF NOT EXISTS idx_ratings_output_build ON ratings(output_id, build_id);
