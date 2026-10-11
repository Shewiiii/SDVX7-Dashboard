import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { cleanPlay, cleanObservation, cleanState, recordId } from '../lib/records.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await readFile(path.join(root, '.local/sync-config.json'), 'utf8'));
const local = JSON.parse(await readFile(path.join(root, '.local/preview-data.json'), 'utf8'));
const response = await fetch(`${config.url}/api/data?verify=${Date.now()}`);
assert.equal(response.status, 200);
const cloud = await response.json();
for (const [kind, cleaner] of [['plays', cleanPlay], ['observations', cleanObservation]]) {
  const expected = new Map(local[kind].map(p => { const clean = cleaner(p); return [recordId(clean), clean]; }));
  const actual = new Map(cloud[kind].map(p => [recordId(p), p]));
  assert.equal(actual.size, expected.size, `${kind}: count differs`);
  for (const [id, record] of expected) assert.deepEqual(actual.get(id), record, `${kind}: missing or changed record`);
}
assert.deepEqual(cloud.state, cleanState(local.state));
const publicText = JSON.stringify(cloud);
assert.ok(!publicText.includes(config.token), 'Upload token exposed');
assert.ok(!publicText.includes('profile_id'), 'Profile identifier exposed');
assert.ok(!publicText.includes('raw_judgments'), 'Raw protocol fields exposed');
console.log(`Cloud verification passed: all ${cloud.plays.length} distinct plays, ${cloud.observations.length} observations, ${cloud.state.charts.length} saved charts match local records. No private upload token or profile identifiers in public data.`);
