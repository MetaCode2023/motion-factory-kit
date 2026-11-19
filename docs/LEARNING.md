# Learning loop (schema only, so far)

The goal: each recording's shorts teach the next edit something, and we can prove it. This file explains the
tables added by `infra/cloudflare/migrations/0002_learning_loop.sql`. Nothing in `sim` reads or writes them yet.

## The idea in five lines

1. Every output records which **ruleset** (version of the lessons file) it was edited with.
2. After it goes public, YouTube numbers are stored at day 3, 7 and 28 (**metric_snapshots**, **reach_daily**).
3. Each output is rated on hook, visuals and pacing by more than one judge (**ratings**). Ratings are stored only.
4. An agent proposes short **lessons**; a human approves each one.
5. An **experiment** splits one recording's shorts 50/50, current rules against current rules plus 1 or 2 new
   lessons, and one test on retention decides whether those lessons are kept or retired.

## Tables

| Table | One row is | Written by |
|---|---|---|
| `rulesets` | A frozen version of the lessons file. Version 0 = no lessons. | Plain code, from approved lessons |
| `experiments` | One control-against-treatment test, with its plan fixed before it starts. | A human starts and closes it |
| `metric_snapshots` | One output's YouTube Analytics numbers at one checkpoint. | The daily metrics pull |
| `reach_daily` | One video's impressions and click-through for one day. | The daily reach report ingest |
| `ratings` | One judge's score for one dimension of one output. | `claude`, `clef-omni`, `owner` |
| `lessons` | One lesson, at most 280 characters, with a check a program can run. | An agent proposes, a human approves |
| `lesson_applications` | Whether a lesson was loaded for an output and whether the cut obeyed it. | The build |
| `v_readout` (view) | Per experiment and arm: shorts published, results still missing, averages. | Read only |

New columns on `outputs`: `duration_s`, `youtube_video_id`, `published_at`, `topic`, `hook_style`,
`experiment_id`, `arm`, `assign_seed`, `ruleset_version`, `editor_model`.

## Rules that the schema enforces

- A lesson without a `check_spec` cannot be stored. If a program cannot check it, it cannot be tested.
- A lesson is at most 280 characters.
- A score is 1 to 5 or empty. Empty means the judge could not answer, never zero.
- `arm` is `control` or `treatment`, nothing else.
- There are no per-lesson win counters on purpose. Lessons tested together get the same verdict, so the
  experiment result is the only evidence.

## Rules the schema cannot enforce

- The primary metric is `rel_retention_mean`: the mean of YouTube's 100 `relativeRetentionPerformance` points
  over the first 7 days. Raw views are stored and never used as the target.
- Ratings change no edit until one validation test, run once, shows they predict retention.
- Only a human sets `approved_by`. Agents never approve a lesson, the same as `sim approve`.

Test: `node --test tests/sim-migrations.test.mjs` applies every migration to an empty SQLite database.
