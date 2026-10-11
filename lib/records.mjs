import { createHash, timingSafeEqual } from 'node:crypto';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const integer = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
const timestamp = (value) => typeof value === 'string' && value.length < 40 && Number.isFinite(Date.parse(value));
const string = (value, limit = 200) => typeof value === 'string' ? value.slice(0, limit) : '';
export const recordId = (record) => createHash('sha256').update(JSON.stringify(
  record.received_at ? [record.received_at, record.music_id, record.diff_idx, record.score, record.clear_type]
    : [record.timestamp, record.total_vf, record.minimum_vf, record.top_count]
)).digest('hex');

export function authorized(header, token) {
  if (!token || token.length < 32 || typeof header !== 'string') return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function cleanPlay(p) {
  if (!p || !integer(p.music_id, 1, 10000000) || !integer(p.diff_idx, 0, 5) ||
      !integer(p.score, 0, 10000000) || !integer(p.clear_type, 0, 6) ||
      !timestamp(p.received_at) || !finite(p.play_vf) || p.play_vf < 0 || p.play_vf > 2) {
    throw new Error('Invalid play');
  }
  return {
    music_id: p.music_id, diff_idx: p.diff_idx, score: p.score, clear_type: p.clear_type,
    received_at: new Date(p.received_at).toISOString(), play_vf: p.play_vf,
    level: finite(p.level) && p.level >= 0 && p.level <= 20 ? p.level : null,
    title: string(p.title), artist: string(p.artist),
    timing: finite(p.timing) && Math.abs(p.timing) <= 134 ? p.timing : null,
  };
}

export function cleanObservation(o) {
  if (!o || !timestamp(o.timestamp) || !finite(o.total_vf) || o.total_vf < 0 || o.total_vf > 100 ||
      !integer(o.top_count, 0, 50) || !(o.minimum_vf === null ||
      (finite(o.minimum_vf) && o.minimum_vf >= 0 && o.minimum_vf <= 2))) throw new Error('Invalid observation');
  return { timestamp: new Date(o.timestamp).toISOString(), total_vf: o.total_vf,
    minimum_vf: o.minimum_vf, top_count: o.top_count };
}

export function cleanState(s) {
  if (!s || !Array.isArray(s.charts) || s.charts.length > 20000) throw new Error('Invalid snapshot');
  const charts = s.charts.map(c => {
    if (!integer(c.music_id, 1, 10000000) || !integer(c.diff_idx, 0, 5) ||
        !finite(c.vf) || c.vf < 0 || c.vf > 2) throw new Error('Invalid chart');
    return { music_id: c.music_id, diff_idx: c.diff_idx, vf: c.vf,
      title: string(c.title), artist: string(c.artist),
      level: finite(c.level) && c.level >= 0 && c.level <= 20 ? c.level : null,
      score: integer(c.score, 0, 10000000) ? c.score : null,
      clear_type: integer(c.clear_type, 0, 6) ? c.clear_type : null };
  });
  const result = { name: string(s.name || 'Shewi', 40), updated_at: timestamp(s.updated_at) ? s.updated_at : null,
    charts, version: 1 };
  if (s.appeal_card !== undefined) result.appeal_card = typeof s.appeal_card === 'string' && /^[a-f0-9]{64}$/.test(s.appeal_card) ? s.appeal_card : null;
  if (s.catalog !== undefined) {
    if (!Array.isArray(s.catalog) || s.catalog.length > 8000) throw new Error('Invalid song catalog');
    result.catalog = s.catalog.map(song => {
      if (!integer(song.music_id, 1, 10000000) || !Array.isArray(song.difficulties) || song.difficulties.length > 6) throw new Error('Invalid song');
      const difficulties = song.difficulties.map(d => {
        if (!integer(d.diff_idx, 0, 5) || !finite(d.level) || d.level <= 0 || d.level > 20) throw new Error('Invalid difficulty');
        return { diff_idx: d.diff_idx, level: d.level, cover: /^[a-f0-9]{64}$/.test(d.cover) ? d.cover : null };
      });
      const forms = Array.isArray(song.forms) ? song.forms.slice(0, 4).map(group =>
        Array.isArray(group) ? group.slice(0, 12).map(form => string(form, 256)).filter(Boolean) : []) : [];
      return { music_id: song.music_id, title: string(song.title), artist: string(song.artist), forms, difficulties };
    });
  }
  return result;
}

export function cleanCover(c) {
  if (!c || !/^[a-f0-9]{64}$/.test(c.id) || typeof c.data !== 'string' || c.data.length > 700000 ||
      !['image/webp', 'image/png'].includes(c.type)) throw new Error('Invalid cover');
  const bytes = Buffer.from(c.data, 'base64');
  const valid = c.type === 'image/webp' ? bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!valid || bytes.length > 524288 || createHash('sha256').update(bytes).digest('hex') !== c.id) throw new Error('Invalid cover content');
  return { id: c.id, type: c.type, data: bytes.toString('base64') };
}
