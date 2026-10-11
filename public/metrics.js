export const DIFFS = ['NOV', 'ADV', 'EXH', 'INF/VVD', 'MXM', 'ULT'];
export const CLEARS = ['No clear', 'Crash', 'Effective', 'Excessive', 'Maxxive', 'UC', 'PUC'];
export const byTime = (a, b) => Date.parse(a.received_at || a.timestamp) - Date.parse(b.received_at || b.timestamp);
export const vf = value => Number.isFinite(value) ? value.toFixed(3) : '—';
export const average = values => values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;

export function sessions(plays) {
  const groups = [];
  for (const play of [...plays].sort(byTime)) {
    const previous = groups.at(-1);
    if (!previous || Date.parse(play.received_at) - Date.parse(previous.at(-1).received_at) > 45 * 60000) groups.push([play]);
    else previous.push(play);
  }
  return groups;
}

export function performance(plays, { days = 0, difficulty = 1, now = Date.now() } = {}) {
  const cutoff = days ? now - days * 86400000 : -Infinity;
  return plays.filter(p => p.clear_type > 1 && p.diff_idx >= difficulty &&
    Number.isFinite(p.play_vf) && Date.parse(p.received_at) >= cutoff).sort(byTime);
}

export function rolling(plays, window) {
  let sum = 0;
  return plays.map((p, index) => {
    sum += p.play_vf;
    if (index >= window) sum -= plays[index - window].play_vf;
    return [Date.parse(p.received_at), sum / Math.min(index + 1, window)];
  });
}

export function visibleObservations(observations, start, end) {
  const sorted = [...observations].sort(byTime);
  let previous;
  const visible = [];
  for (const observation of sorted) {
    const t = Date.parse(observation.timestamp);
    if (t <= start) previous = observation;
    else if (t <= end) visible.push({ ...observation, time: t });
  }
  if (previous) visible.unshift({ ...previous, time: start });
  if (visible.length && visible.at(-1).time < end) visible.push({ ...visible.at(-1), time: end });
  return visible;
}

export function topCharts(state) {
  return [...(state.charts || [])].sort((a, b) => b.vf - a.vf || a.music_id - b.music_id || a.diff_idx - b.diff_idx).slice(0, 50);
}

export function summary(data) {
  const top = topCharts(data.state);
  const observed = [...data.observations].sort(byTime);
  const latest = observed.at(-1);
  const total = top.length ? top.reduce((s, p) => s + p.vf, 0) : latest?.total_vf ?? null;
  return { total, top, best: top[0]?.vf ?? null,
    entry: top.length === 50 ? (Math.round(top[49].vf * 1000) + 1) / 1000 : null,
    growth: total !== null && observed.length ? total - observed[0].total_vf : null,
    sessions: sessions(data.plays) };
}

export function normalizeSearch(value) {
  return String(value).normalize('NFKC').toLocaleLowerCase().replace(/ß/g, 'ss')
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .normalize('NFKD').replace(/[^\p{L}\p{N}\u3099\u309a]/gu, '');
}

export function songCatalog(data) {
  if (data.state.catalog?.length) return data.state.catalog;
  const songs = new Map();
  for (const chart of [...(data.state.charts || []), ...data.plays]) {
    let song = songs.get(chart.music_id);
    if (!song) {
      song = { music_id: chart.music_id, title: chart.title, artist: chart.artist,
        forms: [[normalizeSearch(chart.title)], [], [normalizeSearch(chart.artist)], []], difficulties: [] };
      songs.set(chart.music_id, song);
    }
    if (!song.difficulties.some(d => d.diff_idx === chart.diff_idx)) song.difficulties.push({ diff_idx: chart.diff_idx, level: chart.level });
  }
  return [...songs.values()];
}

export function searchCharts(catalog, query, limit = 25) {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const last = words.at(-1)?.toUpperCase();
  let difficulty = DIFFS.findIndex(name => name === last);
  if (last === 'INF' || last === 'VVD') difficulty = 3;
  if (difficulty >= 0) words.pop();
  const tokens = words.map(normalizeSearch).filter(Boolean), term = tokens.join('');
  const matches = [];
  for (const song of catalog) {
    const groups = song.forms?.length ? song.forms : [[normalizeSearch(song.title)], [], [normalizeSearch(song.artist)], []];
    let rank = tokens.length ? null : [0, 0];
    for (let priority = 0; priority < groups.length && tokens.length; priority++) {
      const matching = groups[priority].filter(form => tokens.every(token => form.includes(token)));
      if (matching.length) { rank = [priority, Math.min(...matching.map(form => form === term ? 0 : form.startsWith(term) ? 1 : 2))]; break; }
    }
    if (!rank && tokens.every(token => groups.some(forms => forms.some(form => form.includes(token))))) rank = [groups.length, 0];
    if (!rank) continue;
    for (const d of song.difficulties) if (difficulty < 0 || d.diff_idx === difficulty) matches.push({ ...song, ...d, rank });
  }
  return matches.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] ||
    (a.title.toLocaleLowerCase() < b.title.toLocaleLowerCase() ? -1 : a.title.toLocaleLowerCase() > b.title.toLocaleLowerCase() ? 1 : 0) ||
    a.music_id - b.music_id || b.diff_idx - a.diff_idx).slice(0, limit);
}

export function chartPlays(data, musicId, difficulty) {
  return data.plays.filter(p => p.music_id === musicId && p.diff_idx === difficulty && p.score > 0 &&
    p.clear_type >= 1 && p.clear_type <= 6 && Number.isFinite(p.play_vf))
    .sort((a, b) => b.score - a.score || byTime(b, a));
}

export function grade(score) {
  return [[9900000, 'S'], [9800000, 'AAA+'], [9700000, 'AAA'], [9500000, 'AA+'], [9300000, 'AA'],
    [9000000, 'A+'], [8700000, 'A'], [7500000, 'B'], [6500000, 'C'], [0, 'D']].find(([min]) => score >= min)?.[1] || '—';
}
