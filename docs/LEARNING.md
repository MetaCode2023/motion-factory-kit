# Learning loop (schema only, so far)

The goal: each recording's shorts teach the next edit something, and we can prove it. This file explains the
tables added by `infra/cloudflare/migrations/0002_learning_loop.sql`. `sim rate` writes `ratings` (rater `clef-omni`); nothing else writes these tables yet.

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

## Ratings from Clef

`node sim.mjs rate <job> [output]` sends each built short (a 480p copy, at most 60 s per part, two parts at most) to
`@cf/cloudflare/clef-omni` and stores four rows per short: `hook`, `visuals`, `pacing`, `overall`, rater `clef-omni`,
`pass` always 1 (Clef is deterministic, so there is no repeat pass), `rubric_version` 1.

- `score` is Clef's 0 to 4 score rounded, plus 1, kept within 1 to 5. `probs` holds the five level probabilities keyed `"1"` to `"5"`
  in the order of the rubric's labels.
- The six yes/no answers (`opens_on_speech`, `stands_alone`, `clear_payoff`, `dead_air`, `screen_changes`, `captions`, each 0 to 1)
  sit in the `overall` row's `probs` under `checks`.
- An answer Clef did not give is a row with a NULL `score` and `stop_reason` `missing_answer`. A failed call writes no rows, logs a
  `rate_failed` event and the next run retries.
- The rubric text is pinned by `tests/sim-rate.test.mjs`. Changing a word means a new `rubric_version`, never an edit in place.
- Each row stores the `build_id` it rated. A rating is current only when it equals `outputs.build_id`.
- A rating call always replaces all four rows, so a retry never mixes two calls. Whatever rows existed before for that short (another
  build, or an incomplete attempt on the same build) are copied into the `rated` event (`detail.previous`); `detail.replaced_build_id`
  is set only when the build differs. Only a short whose four rows are all current with a score is skipped.
- Before skipping a short as already rated, `sim rate` reads `metadata.json` next to its `video.mp4` in R2 and compares its `build_id`
  with `outputs.build_id`. If it is missing or different, the cached video is dropped and the video is downloaded and hashed again.
- The download goes to a `.part` file and is renamed only when it is whole. A cached video whose hash differs from the recorded
  build is deleted and that short fails; a short with no recorded build is always downloaded again.
- `sim propose`, `sim build` and `sim rate` need migration 0004 and stop at once with a message if the database lacks it
  (`node sim.mjs init` applies it).

## Must be solved before anything writes to these tables

`sim propose` re-uses an output's id when a rejected or proposed output is re-proposed with a new span, and
`sim build <job> <output>` re-renders under the same id. Today that would leave the old `experiment_id`, `arm`,
`ruleset_version`, `published_at`, ratings and metric rows attached to a different cut. For `ratings` this is solved by `build_id` (migration 0004): `sim build` sets `outputs.build_id` to the sha256 of the built
`video.mp4`, `sim propose` clears it, and a rating counts only while its `build_id` matches. `metric_snapshots` and
`lesson_applications` still need the same before their writers land: give each build its own identity in their keys, or make
propose and build refuse (or clear the learning columns) when an output already has them.

Also not enforced yet: an active lesson can be stored without `approved_by`, an experiment can name the same
ruleset on both sides, and `arm` can be set without `experiment_id`. Enforce these in the code that writes them.

Test: `node --test tests/sim-migrations.test.mjs` applies every migration to an empty SQLite database.
