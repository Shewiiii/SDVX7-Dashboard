// Independent browser DSP, using the VOX contracts documented at:
// https://github.com/whiteou7/vox2ksh/blob/main/specs/audio_engine.md
// https://github.com/Drewol/unnamed-sdvx-clone/blob/develop/Main/src/Audio/AudioPlayback.cpp
// This recreates the effects, not the proprietary engine's exact output.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const TAU = Math.PI * 2;
const BLOCK = 128;

// Numeric breakpoints of the game's 128-entry device ParamEq table.
export function laserFrequency(value) {
    const v = clamp(Math.floor(value * 127), 0, 127);
    const frequency =
        v < 10
            ? v * 6
            : v < 28
              ? 100 + (v - 10) * 6
              : v < 37
                ? 232 + (v - 28) * 30
                : v < 101
                  ? 522 + (v - 37) * 50
                  : v < 119
                    ? 3852 + (v - 101) * 180
                    : [7400, 7700, 8000, 8400, 8800, 9270, 9750, 10240, 10800][
                          v - 119
                      ];
    return clamp(frequency, 80, 16000);
}

export function validEffects(chart) {
    const e = chart?.effects;
    const row = (r, n) =>
        Array.isArray(r) && r.length >= n && r.every(Number.isFinite);
    const table = (t, limit, n) =>
        Array.isArray(t) &&
        t.length <= limit &&
        t.every((r) => row(r, n) && r.length <= 40);
    return (
        e?.schema === 1 &&
        table(e.definitions, 8192, 1) &&
        e.definitions.every(
            (r) =>
                Number.isInteger(r[0]) &&
                r[0] >= 0 &&
                r[0] <= 255 &&
                r.length >=
                    ([1, 7, 4, 6, 4, 6, 8, 3, 8, 3, 6, 5, 5, 4][r[0]] || 1) &&
                r.every((v) => Math.abs(v) <= 1e6),
        ) &&
        table(e.laser_definitions, 16, 1) &&
        e.laser_definitions.every(
            (r) =>
                Number.isInteger(r[0]) &&
                r[0] >= 0 &&
                r[0] <= 3 &&
                (r[0] === 0 || r.length >= (r[0] === 3 ? 3 : 5)) &&
                r.every((v) => Math.abs(v) <= 1e6),
        ) &&
        table(e.assignments, 8192, 4) &&
        e.assignments.every((r) => r.every((v) => Math.abs(v) <= 1e6)) &&
        [e.fx, e.auto].every(
            (t) =>
                table(t, 200000, 3) &&
                t.every(
                    (r) =>
                        r[0] >= 0 &&
                        r[1] >= r[0] &&
                        r[1] <= 7200 &&
                        Number.isInteger(r[2]) &&
                        r[2] >= 0 &&
                        r[2] < 4096,
                ),
        ) &&
        table(e.chips, 200000, 2) &&
        e.chips.every(
            (r) =>
                r[0] >= 0 &&
                r[0] <= 7200 &&
                Number.isInteger(r[1]) &&
                r[1] > 0 &&
                r[1] <= 14,
        ) &&
        Array.isArray(e.laser_filters) &&
        e.laser_filters.length === chart.lasers.length &&
        e.laser_filters.every(
            (r, i) =>
                Array.isArray(r) &&
                r.length === chart.lasers[i].points.length &&
                r.every((v) => Number.isInteger(v) && v >= 0 && v <= 6),
        ) &&
        (!e.sample_bank ||
            (/^[a-f0-9]{64}$/.test(e.sample_bank.id) &&
                e.sample_bank.rate === 44100 &&
                table(e.sample_bank.entries, 15, 3) &&
                e.sample_bank.entries.every(
                    (r) =>
                        r[0] >= 0 &&
                        r[0] < 44100 * 450 &&
                        r[1] >= 0 &&
                        r[1] <= 44100 * 30 &&
                        r[2] >= 0 &&
                        r[2] <= 4,
                )))
    );
}

export function incompleteEffects(chart) {
    return [...chart.effects.fx, ...chart.effects.auto].some(([, , slot]) => {
        const pair = chart.effects.definitions.slice(slot * 2, slot * 2 + 2);
        return pair.length !== 2 || pair.some((row) => row[0] > 13);
    });
}

function coefficients(type, frequency, q, rate, gain = 0, bandwidth = 1) {
    const w = (TAU * clamp(frequency, 1, rate * 0.49)) / rate;
    const c = Math.cos(w),
        s = Math.sin(w);
    const alpha =
        type === "peak"
            ? s *
              Math.sinh((Math.LN2 * 0.5 * bandwidth * w) / Math.max(s, 1e-9))
            : s / (2 * Math.max(0.1, q));
    if (type === "peak") {
        const a = 10 ** (gain / 40),
            norm = 1 / (1 + alpha / a);
        return [
            (1 + alpha * a) * norm,
            -2 * c * norm,
            (1 - alpha * a) * norm,
            -2 * c * norm,
            (1 - alpha / a) * norm,
        ];
    }
    const norm = 1 / (1 + alpha);
    const b =
        type === "low"
            ? [(1 - c) * 0.5, 1 - c, (1 - c) * 0.5]
            : type === "high"
              ? [(1 + c) * 0.5, -(1 + c), (1 + c) * 0.5]
              : [alpha, 0, -alpha];
    return [...b.map((v) => v * norm), -2 * c * norm, (1 - alpha) * norm];
}

function filter(channels, start, end, get, rate) {
    const states = channels.map(() => [0, 0]);
    for (let n = start; n < end; n += BLOCK) {
        const p = get(n),
            co = coefficients(
                p.type,
                p.frequency,
                p.q ?? 0.7,
                rate,
                p.gain,
                p.bandwidth,
            );
        const mix = clamp(p.mix ?? 1, 0, 1),
            trim = p.trim ?? 1,
            gain = p.makeup ?? 1;
        for (let ch = 0; ch < channels.length; ch++) {
            const data = channels[ch],
                state = states[ch];
            for (let i = n; i < Math.min(n + BLOCK, end); i++) {
                const x = data[i],
                    y = co[0] * x + state[0];
                state[0] = co[1] * x - co[3] * y + state[1];
                state[1] = co[2] * x - co[4] * y;
                data[i] = clamp(((1 - mix) * x + mix * y * gain) * trim, -1, 1);
            }
        }
    }
}

function read(data, at) {
    if (at < 0 || at >= data.length - 1) return data[Math.floor(at)] || 0;
    const i = Math.floor(at);
    return data[i] + (data[i + 1] - data[i]) * (at - i);
}

// Two overlapping Hann grains preserve the timeline while changing pitch.
// The game's SOLA / PhaseGear implementation is proprietary; timbre can differ.
function pitched(data, start, end, semitones, speed, rate) {
    const output = new Float32Array(end - start),
        ratio = 2 ** (semitones / 12);
    if (semitones === 0 && speed === 1) return data.slice(start, end);
    const window = Math.round(rate * 0.046),
        hop = window / 2;
    for (let i = 0; i < output.length; i++) {
        const grain = Math.floor(i / hop);
        let sum = 0,
            weights = 0;
        for (let k = grain - 1; k <= grain; k++) {
            const local = i - k * hop,
                weight = 0.5 - 0.5 * Math.cos((TAU * local) / window);
            const center = k * hop + window / 2;
            sum +=
                read(
                    data,
                    start + center * speed + (local - window / 2) * ratio,
                ) * weight;
            weights += weight;
        }
        output[i] = sum / Math.max(weights, 1e-9);
    }
    return output;
}

function applyEffect(channels, start, end, definition, context) {
    const { rate, beatSeconds, measureBeats, gridOffset, control, assignment } =
        context;
    const id = definition[0];
    if (!id || id > 13 || end <= start) return;
    const parameter = (index, frame, fallback) => {
        const value = definition[index] ?? fallback;
        return assignment?.[1] === index && control
            ? assignment[2] + (assignment[3] - assignment[2]) * control(frame)
            : value;
    };
    const mixAt = (n) =>
        clamp(
            parameter(id === 1 || id === 8 ? 2 : id === 6 ? 3 : 1, n, 100) /
                100,
            0,
            1,
        );
    if (id === 6 || id === 11 || id === 12) {
        const q = parameter(id === 6 ? 7 : 4, start, 0.7);
        filter(
            channels,
            start,
            end,
            (n) => {
                let type, frequency;
                if (id === 6) {
                    type = ["low", "high", "band"][
                        clamp(Math.round(parameter(1, n, 0)), 0, 2)
                    ];
                    const a = Math.max(1, parameter(4, n, 500)),
                        b = Math.max(1, parameter(5, n, 18000)),
                        lo = Math.min(a, b),
                        hi = Math.max(a, b);
                    const period =
                        Math.max(
                            0.1,
                            beatSeconds / Math.max(0.001, parameter(6, n, 4)),
                        ) * rate;
                    const phase = ((n - start) % period) / period;
                    const shape = Math.round(parameter(2, n, 3));
                    const x =
                        shape === 0
                            ? phase
                            : shape === 1
                              ? 1 - phase
                              : shape === 2
                                ? (Math.sin(TAU * phase) + 1) / 2
                                : shape === 4
                                  ? phase >= 0.5
                                      ? 1
                                      : 0
                                  : phase < 0.5
                                    ? phase * 2
                                    : 2 - phase * 2;
                    frequency =
                        shape < 2 ? lo + (hi - lo) * x : lo * (hi / lo) ** x;
                } else {
                    type = id === 11 ? "low" : "high";
                    const lo = Math.max(1, parameter(2, n, 40)),
                        hi = Math.max(1, parameter(3, n, 18000));
                    const x = control
                        ? control(n)
                        : (n - start) / Math.max(1, end - start);
                    frequency = lo * (hi / lo) ** (id === 11 ? 1 - x : x);
                }
                return {
                    type,
                    frequency,
                    q,
                    mix: mixAt(n),
                    trim: type === "band" ? 1 : 1 - clamp(q, 0.1, 20) * 0.04,
                    makeup:
                        type === "band"
                            ? q <= 1
                                ? q + 0.9
                                : Math.min(3, q * 0.2 + 2)
                            : 1,
                };
            },
            rate,
        );
        return;
    }
    // Read-only snapshots allow repetitions, delays and pitch changes to read
    // dry material, including lookahead, without feeding their own output back.
    const copyStart = Math.max(
        0,
        start - (id === 1 || id === 8 ? rate * 8 : 0),
    );
    const copyEnd = Math.min(
        channels[0].length,
        end +
            (id === 9 || id === 13 || id === 10 ? (end - start) * 3 + 4096 : 0),
    );
    const source = channels.map((data) => data.slice(copyStart, copyEnd));
    const pitch =
        id === 9 || id === 13
            ? source.map((data) => {
                  let amount = parameter(2, start, 0);
                  if (id === 9)
                      amount =
                          amount === 0
                              ? 0
                              : Math.sign(amount) *
                                clamp(Math.abs(amount), 1, 12);
                  return pitched(
                      data,
                      start - copyStart,
                      end - copyStart,
                      clamp(amount, -24, 24),
                      id === 13 ? clamp(parameter(3, start, 1), 0, 4) : 1,
                      rate,
                  );
              })
            : null;
    const pitchDry =
        id === 13 && parameter(3, start, 1) !== 1
            ? source.map((data) =>
                  pitched(
                      data,
                      start - copyStart,
                      end - copyStart,
                      0,
                      clamp(parameter(3, start, 1), 0, 4),
                      rate,
                  ),
              )
            : null;
    let tapeIndex = start,
        tapeFraction = 0;
    for (let n = start; n < end; n += BLOCK) {
        const p = (index) => parameter(index, n, 0),
            mix = mixAt(n),
            count = clamp(Math.round(p(1)), 1, 32);
        let period;
        if (id === 1 || id === 8)
            period = clamp(p(3) * beatSeconds, 0.1, 8) * rate;
        else if (id === 2) period = clamp(p(3) * beatSeconds, 0.1, 4) * rate;
        else if (id === 5) period = Math.max(0.1, p(2) * beatSeconds) * rate;
        for (let i = n; i < Math.min(n + BLOCK, end); i++) {
            const elapsed = i - start;
            let index = i,
                gain = 1;
            if (id === 1 || id === 8) {
                const slice = Math.max(1, Math.floor(period / count));
                const phase = elapsed + (id === 1 ? gridOffset(p(3)) : 0);
                const repeat = Math.floor(phase / slice) % count,
                    rem = phase % slice;
                const gate = Math.floor(slice * clamp(p(5), 0.1, 1)),
                    fade = Math.floor(gate * clamp(p(6), 0, 1));
                index = i - repeat * slice;
                gain =
                    rem > gate
                        ? 0
                        : clamp(p(4), 0.1, 1) ** repeat *
                          (fade && rem > gate - fade ? (gate - rem) / fade : 1);
            } else if (id === 2) {
                const step = Math.max(
                    1,
                    Math.floor(period / clamp(p(2), 1, 32)),
                );
                gain =
                    (Math.floor((elapsed % period) / step) % 2 ? 4 : 32) *
                    0.0322;
            } else if (id === 4) {
                const total = clamp(p(3), 0.1, 2) * rate;
                if (tapeFraction < 1) {
                    tapeFraction +=
                        1 + ((tapeIndex - start) / total) * clamp(p(2), 1, 10);
                    tapeIndex++;
                }
                tapeFraction--;
                index = tapeIndex;
                gain = Math.max(0, 1 - elapsed / total);
            } else if (id === 5) {
                const t = elapsed % period,
                    a = clamp(p(3), 0, 100) * 0.002 * period,
                    h = clamp(p(4), 0, 100) * 0.003 * period,
                    r = clamp(p(5), 0, 100) * 0.005 * period;
                gain =
                    t < a
                        ? 1 - t / a
                        : t < a + h
                          ? 0
                          : t < a + h + r
                            ? (t - a - h) / r
                            : 1;
            } else if (id === 7) {
                index = i - ((i - n) % clamp(Math.round(p(2)), 1, 30));
            } else if (id === 10) {
                const duration = clamp(p(3) * beatSeconds, 0.1, 2) * rate,
                    preroll = Math.max(0, p(4) * beatSeconds) * rate,
                    window = clamp(p(5) * beatSeconds, 0.1, 2) * rate;
                const phase = elapsed - Math.min(preroll, duration);
                if (phase >= 0) {
                    const progress = clamp(phase / window, 0, 1);
                    const speed = clamp(p(2), 1, 10);
                    index =
                        start +
                        Math.min(preroll, duration) +
                        (window *
                            Math.log(
                                (1 + speed) / (1 + speed - speed * progress),
                            )) /
                            Math.log(1 + speed);
                    gain = phase > window ? 0 : 0.5 + 0.5 * progress;
                }
            }
            for (let ch = 0; ch < channels.length; ch++) {
                const dry = pitchDry
                    ? pitchDry[ch][elapsed]
                    : source[ch][i - copyStart];
                const wet = pitch
                    ? pitch[ch][elapsed]
                    : read(source[ch], index - copyStart) * gain;
                channels[ch][i] = clamp((1 - mix) * dry + mix * wet, -1, 1);
            }
        }
    }
    if (id === 3) {
        // Flanger has a separate stereo delay pass; period is authored in measures.
        for (let ch = 0; ch < channels.length; ch++) {
            let input = source[ch];
            const stages = clamp(parameter(5, start, 2), 0, 4),
                passes = Math.ceil(stages);
            for (let pass = passes; pass >= 0; pass--) {
                const output = new Float32Array(end - start);
                for (let i = start; i < end; i++) {
                    const delay =
                        (clamp(parameter(2, i, 2), 0.1, 3) * rate) / 1000;
                    const hz =
                        Math.max(
                            0,
                            parameter(3, i, 0.5) / (measureBeats * beatSeconds),
                        ) * 0.5;
                    const mod = Math.sin(
                        ((i - start) * hz * TAU) / rate + (ch * Math.PI) / 2,
                    );
                    const at =
                        i -
                        (delay +
                            mod *
                                delay *
                                clamp(parameter(4, i, 90) / 100, 0, 1));
                    const x =
                        input === source[ch]
                            ? source[ch][i - copyStart]
                            : input[i - start];
                    const y = read(
                        input,
                        input === source[ch] ? at - copyStart : at - start,
                    );
                    const mix = mixAt(i),
                        partial = pass === passes ? passes - stages : 0;
                    output[i - start] =
                        (y * (mix - (1 - mix) * partial) +
                            x * (1 - mix + partial * mix)) *
                        (stages >= 1 && pass === 0 ? 1.5 : 1);
                }
                input = output;
            }
            for (let i = start; i < end; i++)
                channels[ch][i] = clamp(input[i - start], -1, 1);
        }
    }
}

function laserTracks(chart, rate, offset) {
    const tracks = [[], []];
    chart.lasers.forEach((laser, l) => {
        laser.points.forEach((p, i) => {
            if (i + 1 >= laser.points.length) return;
            const next = laser.points[i + 1];
            tracks[laser.side].push({
                start: Math.round((p[0] + offset) * rate),
                end: Math.round((next[0] + offset) * rate),
                from: clamp(laser.side ? 1 - p[1] : p[1], 0, 1),
                to: clamp(laser.side ? 1 - next[1] : next[1], 0, 1),
                effect: chart.effects.laser_filters[l][i],
            });
        });
    });
    return tracks.map((track) => track.sort((a, b) => a.start - b.start));
}

function laserReader(tracks) {
    const cursors = [0, 0];
    let last = -Infinity;
    return (frame) => {
        if (frame < last) cursors.fill(0);
        last = frame;
        return tracks
            .map((track, side) => {
                let cursor = cursors[side];
                while (cursor < track.length && track[cursor].end <= frame)
                    cursor++;
                cursors[side] = cursor;
                const part = track[cursor];
                return part && part.start <= frame && frame < part.end
                    ? {
                          ...part,
                          value:
                              part.from +
                              ((part.to - part.from) * (frame - part.start)) /
                                  Math.max(1, part.end - part.start),
                      }
                    : null;
            })
            .filter(Boolean);
    };
}

function applyLasers(channels, chart, tracks, rate) {
    const get = laserReader(tracks),
        delayed = laserReader(tracks),
        states = channels.map(() => [0, 0]);
    let duck = 1;
    for (let n = 0; n < channels[0].length; n += BLOCK) {
        const active = get(n);
        const positions = active.some((p) => p.effect !== 0)
            ? []
            : delayed(n - Math.round(0.08 * rate)).filter(
                  (p) => p.effect === 0,
              );
        const knob = positions.length
            ? Math.max(...positions.map((p) => p.value))
            : 0;
        const v = clamp(Math.floor(knob * 127), 0, 127);
        const frequency = laserFrequency(knob);
        const gain =
            v < 4
                ? 0
                : frequency < 200
                  ? frequency * 0.075
                  : frequency < 1000
                    ? 15
                    : 15 - (frequency - 1000) * 0.0005;
        const bandwidth =
            (frequency < 200
                ? frequency * 0.075
                : frequency < 1000
                  ? 15
                  : 15 - (frequency - 1000) * 0.0003) / 12;
        const co = coefficients(
            "peak",
            frequency,
            1,
            rate,
            gain,
            Math.max(0.1, bandwidth),
        );
        const target =
            v < 4
                ? 1
                : v < 95
                  ? 0.8 - (v - 4) * 0.0025274728
                  : v < 100
                    ? 0.57
                    : v < 120
                      ? 0.57 + (v - 100) * 0.0115
                      : 0.8;
        for (let i = n; i < Math.min(n + BLOCK, channels[0].length); i++) {
            duck += clamp(target - duck, -0.33 / rate, 0.33 / rate);
            for (let ch = 0; ch < channels.length; ch++) {
                const x = channels[ch][i],
                    state = states[ch],
                    y = co[0] * x + state[0];
                state[0] = co[1] * x - co[3] * y + state[1];
                state[1] = co[2] * x - co[4] * y;
                channels[ch][i] = clamp(y * duck, -1, 1);
            }
        }
    }
    for (let side = 0; side < 2; side++) {
        const track = tracks[side];
        for (let begin = 0; begin < track.length; ) {
            const first = track[begin];
            let end = begin + 1;
            while (
                end < track.length &&
                track[end].effect === first.effect &&
                track[end].start === track[end - 1].end
            )
                end++;
            const definition =
                chart.effects.laser_definitions[first.effect - 1];
            if (definition && first.effect < 6) {
                const start = Math.max(0, first.start),
                    finish = Math.min(channels[0].length, track[end - 1].end);
                let cursor = begin;
                const position = (n) => {
                    while (cursor + 1 < end && track[cursor].end <= n) cursor++;
                    const p = track[cursor];
                    return (
                        p.from +
                        (p.to - p.from) *
                            clamp(
                                (n - p.start) / Math.max(1, p.end - p.start),
                                0,
                                1,
                            )
                    );
                };
                if (definition[0] === 3) {
                    for (let n = start; n < finish; n += BLOCK) {
                        const amount = Math.floor(position(n) * 29 + 1),
                            mix = clamp(definition[1] / 100, 0, 1);
                        for (const data of channels)
                            for (
                                let i = Math.min(n + BLOCK, finish) - 1;
                                i >= n;
                                i--
                            )
                                data[i] =
                                    (1 - mix) * data[i] +
                                    mix * data[i - ((i - n) % amount)];
                    }
                } else {
                    filter(
                        channels,
                        start,
                        finish,
                        (n) => {
                            const [id, mix, lo, hi, q] = definition,
                                v = position(n);
                            return {
                                type: id === 1 ? "low" : "high",
                                frequency:
                                    Math.max(1, lo) *
                                    (Math.max(1, hi) / Math.max(1, lo)) **
                                        (id === 1 ? 1 - v : v),
                                q,
                                mix: mix / 100,
                                trim: 1 - clamp(q, 0.1, 20) * 0.04,
                            };
                        },
                        rate,
                    );
                }
            }
            begin = end;
        }
    }
}

export function renderChartAudio({
    channels,
    rate,
    chart,
    record,
    samples,
    progress = () => {},
}) {
    if (!validEffects(chart)) throw Error("Invalid chart effects");
    if (
        rate !== 44100 ||
        channels.length < 1 ||
        channels.length > 2 ||
        !channels.every(
            (c) => c instanceof Float32Array && c.length === channels[0].length,
        ) ||
        channels[0].length > rate * 600
    )
        throw Error("Unsupported audio size");
    const offset = record.chart_offset - record.start;
    const frame = (time) => Math.round((time + offset) * rate),
        tracks = laserTracks(chart, rate, offset);
    const tempos = chart.tempos;
    const beats = [0];
    for (let i = 1; i < tempos.length; i++)
        beats[i] =
            beats[i - 1] +
            ((tempos[i][0] - tempos[i - 1][0]) * tempos[i - 1][1]) / 60;
    const timingAt = (time) => {
        let i = 0;
        while (i + 1 < tempos.length && tempos[i + 1][0] <= time) i++;
        return {
            bpm: tempos[i][1],
            beat: beats[i] + ((time - tempos[i][0]) * tempos[i][1]) / 60,
        };
    };
    const events = [
        ...chart.effects.fx.map((r) => [...r, false]),
        ...chart.effects.auto.map((r) => [...r, true]),
    ].sort((a, b) => a[0] - b[0]);
    const seen = new Set();
    events.forEach(([from, to, slot, auto], eventIndex) => {
        const key = `${from}:${to}:${slot}:${auto}`;
        if (seen.has(key)) return;
        seen.add(key);
        const start = clamp(frame(from), 0, channels[0].length),
            end = clamp(frame(to), 0, channels[0].length);
        const { bpm, beat } = timingAt(from),
            beatSeconds = 60 / bpm;
        const measure = chart.measures.findIndex(([at]) => at > from);
        const m = Math.max(
            0,
            measure < 0 ? chart.measures.length - 2 : measure - 1,
        );
        const measureBeats =
            (chart.measures[m + 1]?.[0] - chart.measures[m]?.[0]) /
                beatSeconds || 4;
        const controlAt = laserReader(tracks);
        const control = (n) =>
            Math.max(
                0,
                ...controlAt(n)
                    .filter((p) => p.effect === 6)
                    .map((p) => p.value),
            );
        for (let part = 0; part < 2; part++) {
            const definition = chart.effects.definitions[slot * 2 + part];
            if (definition)
                applyEffect(channels, start, end, definition, {
                    rate,
                    beatSeconds,
                    measureBeats,
                    gridOffset: (length) =>
                        Math.round(
                            (((beat % Math.max(0.001, length)) +
                                Math.max(0.001, length)) %
                                Math.max(0.001, length)) *
                                beatSeconds *
                                rate,
                        ),
                    control: auto ? control : null,
                    assignment: auto
                        ? chart.effects.assignments[slot * 2 + part]
                        : null,
                });
        }
        if (eventIndex % 16 === 0)
            progress((0.65 * (eventIndex + 1)) / Math.max(1, events.length));
    });
    applyLasers(channels, chart, tracks, rate);
    progress(0.85);
    if (samples && chart.effects.sample_bank) {
        const triggers = [...chart.effects.chips];
        chart.lasers.forEach((laser) =>
            laser.points.forEach((p, i) => {
                const previous = laser.points[i - 1];
                if (
                    previous &&
                    Math.abs(p[0] - previous[0]) < 0.00001 &&
                    Math.abs(p[1] - previous[1]) > 1e-6
                )
                    triggers.push([p[0], 0]);
            }),
        );
        const voices = new Map();
        triggers
            .sort((a, b) => a[0] - b[0])
            .forEach(([time, id]) => {
                if (!voices.has(id)) voices.set(id, []);
                const list = voices.get(id),
                    at = frame(time);
                if (list.at(-1) !== at) list.push(at);
            });
        for (const [id, list] of voices) {
            const entry = chart.effects.sample_bank.entries[id];
            if (!entry) continue;
            const [source, length, gain] = entry;
            if (source + length > samples[0].length)
                throw Error("Invalid sample bank offsets");
            list.forEach((at, index) => {
                const finish = Math.min(
                    channels[0].length,
                    at + length,
                    list[index + 1] ?? Infinity,
                );
                for (let ch = 0; ch < channels.length; ch++)
                    for (let i = Math.max(0, at); i < finish; i++)
                        channels[ch][i] +=
                            samples[Math.min(ch, samples.length - 1)][
                                source + i - at
                            ] * gain;
            });
        }
    }
    progress(1);
    return channels;
}

export function encodeWav(channels, rate) {
    const count = channels.length,
        frames = channels[0].length;
    const buffer = new ArrayBuffer(44 + frames * count * 2),
        view = new DataView(buffer);
    const string = (at, s) => {
        for (let i = 0; i < s.length; i++)
            view.setUint8(at + i, s.charCodeAt(i));
    };
    string(0, "RIFF");
    view.setUint32(4, buffer.byteLength - 8, true);
    string(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, count, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * count * 2, true);
    view.setUint16(32, count * 2, true);
    view.setUint16(34, 16, true);
    string(36, "data");
    view.setUint32(40, buffer.byteLength - 44, true);
    for (let i = 0; i < frames; i++)
        for (let ch = 0; ch < count; ch++)
            view.setInt16(
                44 + (i * count + ch) * 2,
                Math.round(clamp(channels[ch][i], -1, 1) * 32767),
                true,
            );
    return buffer;
}
