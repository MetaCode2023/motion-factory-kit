// Content engine: weekly slots, pillar balance, checks and review decisions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReview, checkPlan, isoWeek, makePlan } from '../content.mjs';

const B = { name: 'T', pillars: [{ name: 'teach', share: 0.5 }, { name: 'proof', share: 0.5 }], channels: [{ name: 'a', format: 'short', per_week: 3 }, { name: 'b', format: 'short', per_week: 1 }] };
const ideas = [{ n: 3, used: false, text: 'T1', pillar: 'teach' }, { n: 4, used: true, text: 'old', pillar: 'teach' }, { n: 5, used: false, text: 'P1', pillar: 'proof' }];

test('a week gets one slot per channel post, pillars balanced, unused ideas placed by pillar', () => {
  const { plan, used } = makePlan('t', '2026-W47', B, ideas);
  assert.equal(plan.posts.length, 4);
  assert.equal(plan.posts.filter((p) => p.pillar === 'teach').length, 2);
  assert.deepEqual(used.sort(), [3, 5]);
  assert.ok(!plan.posts.some((p) => p.idea === 'old'));
  assert.equal(plan.posts.find((p) => p.idea === 'T1').pillar, 'teach');
});

test('check asks for an idea and a short hook; a note on an approval keeps the post out of the queue', () => {
  const { plan } = makePlan('t', '2026-W47', B, ideas);
  assert.ok(checkPlan('t', plan).fixes.some((f) => f.includes('no hook')));
  plan.posts[0].hook = 'one two three four five six seven eight nine ten eleven twelve thirteen';
  assert.ok(checkPlan('t', plan).fixes.some((f) => f.includes('13 words')));
  plan.posts.forEach((p) => { p.status = 'built'; });
  applyReview('t', plan, { decisions: { [plan.posts[0].id]: { decision: 'approved', note: '' }, [plan.posts[1].id]: { decision: 'approved', note: 'fix the caption' }, [plan.posts[2].id]: { decision: 'rejected', note: '' } } });
  assert.deepEqual(plan.posts.map((p) => p.status), ['approved', 'built', 'rejected', 'built']);
});

test('weeks are ISO weeks', () => { assert.equal(isoWeek(new Date(2026, 10, 16)), '2026-W47'); });
