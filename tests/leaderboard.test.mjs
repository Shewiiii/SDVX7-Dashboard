import test from 'node:test';
import assert from 'node:assert/strict';
import { searchCharts, normalizeSearch, chartPlays, grade, CLEARS } from '../public/metrics.js';
import { cleanState, cleanCover } from '../lib/records.mjs';
import { createHash } from 'node:crypto';

const songs = [
  { music_id: 1, title: 'ピカピカ', artist: 'Camellia', forms: [['ひかひか', 'pikapika'], [], ['camellia'], []], difficulties: [{ diff_idx: 1, level: 8 }, { diff_idx: 4, level: 18 }] },
  { music_id: 2, title: 'Pika Pika Remix', artist: 'Other', forms: [['pikapikaremix'], [], ['other'], []], difficulties: [{ diff_idx: 4, level: 19 }] },
];
test('song search uses romanized forms, normalized kana, artists, and a trailing difficulty', () => {
  assert.deepEqual(searchCharts(songs, 'pika pika MXM').map(c => [c.music_id, c.diff_idx]), [[1, 4], [2, 4]]);
  assert.deepEqual(searchCharts(songs, 'Camellia ADV').map(c => [c.music_id, c.diff_idx]), [[1, 1]]);
  assert.equal(normalizeSearch('ＰＩＫＡ－ＰＩＫＡ'), 'pikapika');
  assert.equal(normalizeSearch('カメリア'), normalizeSearch('かめりあ'));
  assert.equal(searchCharts(songs, 'unmatched').length, 0);
});
test('leaderboard isolates song AND difficulty and ranks score first, with date breaking ties regardless of VF', () => {
  const base = { music_id: 1, diff_idx: 4, clear_type: 2, score: 9900000, play_vf: .35, received_at: '2026-10-01T12:00:00Z' };
  const plays = [base, { ...base, score: 9800000, play_vf: .4 }, { ...base, received_at: '2026-10-02T12:00:00Z' },
    { ...base, diff_idx: 1 }, { ...base, music_id: 2 }, { ...base, score: 0 }, { ...base, clear_type: 1, play_vf: .1, received_at: '2026-10-03T12:00:00Z' }];
  const sorted = chartPlays({ plays }, 1, 4);
  assert.deepEqual(sorted.map(p => p.score), [9900000, 9900000, 9900000, 9800000]);
  assert.deepEqual(sorted.map(p => p.play_vf), [.1, .35, .35, .4]);
  assert.equal(sorted[1].received_at, '2026-10-02T12:00:00Z');
  assert.deepEqual(chartPlays({ plays }, 9, 4), []);
  assert.equal(CLEARS[5], 'UC'); assert.equal(CLEARS[6], 'PUC');
  assert.equal(grade(9800000), 'AAA+');
});
test('catalog and cover ingestion rejects untrusted image URLs and mismatched image hashes', () => {
  const state = cleanState({ charts: [], catalog: [{ ...songs[0], difficulties: [{ diff_idx: 4, level: 18, cover: 'https://example.org' }] }] });
  assert.equal(state.catalog[0].difficulties[0].cover, null);
  assert.throws(() => cleanCover({ id: 'a'.repeat(64), type: 'image/svg+xml', data: '' }));
  const bytes = Buffer.from('RIFFxxxxWEBPtest');
  const id = createHash('sha256').update(bytes).digest('hex');
  assert.equal(cleanCover({ id, type: 'image/webp', data: bytes.toString('base64') }).id, id);
  assert.throws(() => cleanCover({ id: 'a'.repeat(64), type: 'image/webp', data: bytes.toString('base64') }));
});
