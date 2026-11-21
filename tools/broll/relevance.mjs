// Pluggable image/text relevance. The built-in fallback is transparent metadata overlap; it is not CLIP.
// Set BROLL_RELEVANCE_CMD to a local executable that reads one JSON object per line and replies
// {"score":0..1,"reason":"..."}. That executable can host OpenCLIP/SigLIP without making this kit heavy.
import { spawnSync } from 'node:child_process';

const STOP = new Set('the a an and or but to of in on at for with is it this that from by as be are was were'.split(' '));
const terms = (s) => [...new Set(String(s).toLowerCase().match(/[a-z0-9]+/g) || [])].filter((x) => x.length > 2 && !STOP.has(x));

export function metadataRelevance(line, media) {
  const wanted = terms(line);
  const have = new Set(terms(`${media.title || ''} ${media.tags || ''}`));
  const hit = wanted.filter((x) => have.has(x));
  const score = wanted.length ? hit.length / wanted.length : 0;
  return { score: +score.toFixed(3), reason: hit.length ? `metadata matches: ${hit.join(', ')}` : 'no narration terms found in title/tags' };
}

export function localRelevance(line, media, command = process.env.BROLL_RELEVANCE_CMD) {
  if (!command) return metadataRelevance(line, media);
  const r = spawnSync(command, [], { input: JSON.stringify({ text: line, image: media.url, media }) + '\n', encoding: 'utf8', timeout: 30000 });
  if (r.status === 0) {
    try {
      const out = JSON.parse(r.stdout.trim().split('\n').pop());
      if (Number.isFinite(out.score)) return { score: Math.max(0, Math.min(1, +out.score)), reason: out.reason || `local scorer: ${command}` };
    } catch {}
  }
  const fallback = metadataRelevance(line, media);
  return { ...fallback, reason: `${fallback.reason}; local scorer failed (${command})` };
}
