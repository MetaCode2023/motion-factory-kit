// The D1 migrations in infra/cloudflare/migrations apply cleanly, in order, to an empty SQLite database
// (D1 is SQLite), and the learning-loop tables accept the rows the loop writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'infra', 'cloudflare', 'migrations');

function fresh() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.sql')).sort()) db.exec(readFileSync(join(DIR, f), 'utf8'));
  return db;
}

function seed(db) {
  db.exec(`INSERT INTO jobs (id, source_filename, source_bytes) VALUES ('j1', 'a.mp4', 1)`);
  db.exec(`INSERT INTO outputs (id, job_id, kind, start_s, end_s, slug) VALUES ('j1/short/a', 'j1', 'short', 0, 30, 'a')`);
}

test('learning-loop tables exist after all migrations', () => {
  const db = fresh();
  const names = db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table','view')`).all().map((r) => r.name);
  for (const t of ['rulesets', 'experiments', 'metric_snapshots', 'reach_daily', 'ratings', 'lessons', 'lesson_applications', 'v_readout'])
    assert.ok(names.includes(t), `missing ${t}`);
});

test('existing tables keep their columns and gain the experiment columns', () => {
  const db = fresh();
  const cols = db.prepare(`PRAGMA table_info(outputs)`).all().map((r) => r.name);
  for (const c of ['r2_prefix', 'posted_urls', 'status', 'youtube_video_id', 'published_at', 'experiment_id', 'arm', 'ruleset_version', 'editor_model'])
    assert.ok(cols.includes(c), `outputs.${c}`);
  const jobs = db.prepare(`PRAGMA table_info(jobs)`).all().map((r) => r.name);
  assert.deepEqual(jobs.filter((c) => c.startsWith('lease') || c === 'claimed_by'), ['claimed_by', 'lease_expires_at']);
});

test('output ids are text, so ratings and snapshots can reference <job>/<kind>/<slug>', () => {
  const db = fresh();
  seed(db);
  db.exec(`INSERT INTO ratings (output_id, dimension, rater, rubric_version, score, probs, rated_at)
           VALUES ('j1/short/a', 'hook', 'clef-omni', 1, 4, '{"1":0.02,"4":0.61}', '2026-11-18T00:00:00Z')`);
  db.exec(`INSERT INTO metric_snapshots (output_id, checkpoint_day, window_start, window_end, status, first_fetched_at, fetched_at, rel_retention_mean)
           VALUES ('j1/short/a', 7, '2026-11-18', '2026-11-25', 'final', 'x', 'x', 0.55)`);
  assert.throws(() => db.exec(`INSERT INTO ratings (output_id, dimension, rater, rubric_version, rated_at) VALUES ('nope', 'hook', 'claude', 1, 'x')`));
  assert.throws(() => db.exec(`INSERT INTO ratings (output_id, dimension, rater, rubric_version, score, rated_at) VALUES ('j1/short/a', 'pacing', 'claude', 1, 9, 'x')`));
});

test('a lesson needs a check and at most 280 characters', () => {
  const db = fresh();
  db.exec(`INSERT INTO lessons (text, stage, check_spec, origin, status, stated_at) VALUES ('Open on the first spoken word.', 'edit', '{"first_word_before_s":0.5}', 'back_catalog', 'hypothesis', 'x')`);
  assert.throws(() => db.exec(`INSERT INTO lessons (text, stage, check_spec, origin, status, stated_at) VALUES ('${'a'.repeat(281)}', 'edit', '{}', 'live', 'hypothesis', 'x')`));
  assert.throws(() => db.exec(`INSERT INTO lessons (text, stage, origin, status, stated_at) VALUES ('no check', 'edit', 'live', 'hypothesis', 'x')`));
});

test('the readout view counts published shorts per arm and reports missing results', () => {
  const db = fresh();
  seed(db);
  db.exec(`INSERT INTO rulesets (version, r2_key, sha256, base_rules_sha, created_at) VALUES (0, 'k0', 's', 'b', 'x'), (1, 'k1', 's', 'b', 'x')`);
  db.exec(`INSERT INTO experiments (id, control_ruleset, treatment_ruleset, primary_metric, target_n_per_arm, prereg_r2_key, started_at) VALUES (1, 0, 1, 'rel_retention_mean', 40, 'p', 'x')`);
  db.exec(`INSERT INTO outputs (id, job_id, kind, start_s, end_s, slug, experiment_id, arm, published_at) VALUES ('j1/short/b', 'j1', 'short', 40, 70, 'b', 1, 'treatment', 'x')`);
  db.exec(`UPDATE outputs SET experiment_id = 1, arm = 'control', published_at = 'x' WHERE id = 'j1/short/a'`);
  db.exec(`INSERT INTO metric_snapshots (output_id, checkpoint_day, window_start, window_end, status, first_fetched_at, fetched_at, rel_retention_mean) VALUES ('j1/short/a', 7, 'a', 'b', 'final', 'x', 'x', 0.5)`);
  const rows = db.prepare(`SELECT arm, n_published, n_missing FROM v_readout ORDER BY arm`).all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ arm: 'control', n_published: 1, n_missing: 0 }, { arm: 'treatment', n_published: 1, n_missing: 1 }]);
  assert.throws(() => db.exec(`UPDATE outputs SET arm = 'both' WHERE id = 'j1/short/a'`));
});

test('the readout treats a day-7 result as missing until it is final', () => {
  const db = fresh();
  seed(db);
  db.exec(`INSERT INTO rulesets (version, r2_key, sha256, base_rules_sha, created_at) VALUES (0, 'k0', 's', 'b', 'x'), (1, 'k1', 's', 'b', 'x')`);
  db.exec(`INSERT INTO experiments (id, control_ruleset, treatment_ruleset, primary_metric, target_n_per_arm, prereg_r2_key, started_at) VALUES (1, 0, 1, 'rel_retention_mean', 40, 'p', 'x')`);
  db.exec(`UPDATE outputs SET experiment_id = 1, arm = 'control', published_at = 'x' WHERE id = 'j1/short/a'`);
  db.exec(`INSERT INTO metric_snapshots (output_id, checkpoint_day, window_start, window_end, status, first_fetched_at, fetched_at, rel_retention_mean) VALUES ('j1/short/a', 7, 'a', 'b', 'provisional', 'x', 'x', 0.9)`);
  const one = () => ({ ...db.prepare(`SELECT n_published, n_missing, rel_retention_mean FROM v_readout`).get() });
  assert.deepEqual(one(), { n_published: 1, n_missing: 1, rel_retention_mean: null });
  db.exec(`UPDATE metric_snapshots SET status = 'final' WHERE output_id = 'j1/short/a'`);
  assert.deepEqual(one(), { n_published: 1, n_missing: 0, rel_retention_mean: 0.9 });
});
