export const NOTES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;
export const FLAT_NOTES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];
export const RANGES = {
  high: { label: "Highギター", octave: 4 },
  low: { label: "Lowギター", octave: 3 },
  bass: { label: "ベース", octave: 2 },
} as const;
export type RangeMode = keyof typeof RANGES;
export type Settings = { notation: "sharp" | "flat"; range: RangeMode };
export const DEFAULT_SETTINGS: Settings = { notation: "sharp", range: "high" };
export type AnalysisReset = { at: string; counts: Record<string, number> };
export function frequency(note: number, range: RangeMode = "high") {
  return 440 * 2 ** (((RANGES[range].octave + 1) * 12 + note - 69) / 12);
}
export type Level = 1 | 2 | 3;
export const CHORDS = {
  M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  "7": [0, 4, 7, 10],
  m7b5: [0, 3, 6, 10],
} as const;
export type ChordKind = keyof typeof CHORDS;
export const CHORD_KINDS: ChordKind[] = ["M7", "m7", "7", "m7b5"];
export type Question = {
  note: number;
  range: RangeMode;
  level?: Level;
  secondNote?: number;
  chord?: ChordKind;
};
export function questionKey(q: {
  note: number;
  range?: RangeMode;
  level?: Level;
  secondNote?: number;
  chord?: ChordKind;
}) {
  return `${q.level ?? 1}:${q.range ?? "high"}:${q.note}:${q.secondNote ?? ""}:${q.chord ?? ""}`;
}
export function questionLabel(
  q: { note: number; level?: Level; secondNote?: number; chord?: ChordKind },
  names: readonly string[] = NOTES,
) {
  return (q.level ?? 1) === 2
    ? `${names[q.note]} → ${names[q.secondNote!]}`
    : `${names[q.note]}${q.chord ?? ""}`;
}
export function chordNotes(note: number, chord: ChordKind) {
  return CHORDS[chord].map((interval) => note + interval);
}
export function attemptPoints(a: Attempt, level: Level = a.level ?? 1) {
  if (level === 2) {
    const n =
      Number(a.answer === a.note) + Number(a.secondAnswer === a.secondNote);
    return n === 2 ? 5 : n === 1 ? 2 : 0;
  }
  return a.answer === a.note && (level !== 3 || a.answerChord === a.chord)
    ? 5
    : 0;
}
export function fullyCorrect(a: Attempt, level: Level = a.level ?? 1) {
  return attemptPoints(a, level) === 5;
}
export function unanswered(a: Attempt, level: Level = a.level ?? 1) {
  return level === 2
    ? a.answer === null && (a.secondAnswer ?? null) === null
    : a.answer === null;
}
export function hasWrongAnswer(a: Attempt, level: Level = a.level ?? 1) {
  if (level === 2)
    return (
      (a.answer !== null && a.answer !== a.note) ||
      ((a.secondAnswer ?? null) !== null && a.secondAnswer !== a.secondNote)
    );
  return !unanswered(a, level) && !fullyCorrect(a, level);
}
export function generateQuestions(
  level: Level,
  range: RangeMode,
  random = Math.random,
): Question[] {
  if (level === 1)
    return levelOneQuestions(random).map((note) => ({ note, range, level }));
  if (level === 2) {
    const first = levelOneQuestions(random),
      second = levelOneQuestions(random);
    return first.map((note, i) => ({
      note,
      range,
      level,
      secondNote: second[i],
    }));
  }
  const candidates = NOTES.flatMap((_, note) =>
    CHORD_KINDS.map((chord) => ({ note, range, level, chord })),
  );
  return shuffle(candidates, random).slice(0, 20);
}
export type Attempt = {
  level?: Level;
  secondNote?: number;
  secondAnswer?: number | null;
  chord?: ChordKind;
  answerChord?: ChordKind | null;
  range?: RangeMode;
  id: string;
  sessionId: string;
  note: number;
  answer: number | null;
  at: string;
  elapsed: number;
  mode: "normal" | "review";
};
export type Session = {
  id: string;
  started: string;
  timezone: string;
  ended?: string;
  status: "active" | "complete" | "interrupted";
  mode: "normal" | "review";
  total: number;
  level: Level;
  range?: RangeMode;
  attempts: Attempt[];
};
export type Review = {
  level?: Level;
  secondNote?: number;
  chord?: ChordKind;
  range?: RangeMode;
  note: number;
  first: string;
  last: string;
  count: number;
  pending: boolean;
};
export type Data = {
  schemaVersion: 1;
  settings?: Settings;
  analysisRangeResets?: Record<string, AnalysisReset>;
  analysisResets?: Partial<Record<1 | 2 | 3, AnalysisReset>>;
  sessions: Session[];
  reviews: Review[];
  debug: Attempt[];
};
export const empty = (): Data => ({
  schemaVersion: 1,
  sessions: [],
  reviews: [],
  debug: [],
});
export const score = (s: Session) =>
  s.attempts.reduce((sum, a) => sum + attemptPoints(a, a.level ?? s.level), 0);
export function record(data: Data, a: Attempt): Data {
  const d = structuredClone(data);
  const session = d.sessions.find((s) => s.id === a.sessionId);
  if (
    !session ||
    session.status !== "active" ||
    session.attempts.length >= session.total ||
    session.attempts.some((x) => x.id === a.id)
  )
    return d;
  const normalized = {
    ...a,
    level: a.level ?? session.level,
    range: a.range ?? session.range ?? ("high" as RangeMode),
  };
  session.attempts.push(normalized);
  const item = d.reviews.find(
    (r) => questionKey(r) === questionKey(normalized),
  );
  if (unanswered(normalized)) d.debug = [...d.debug, normalized].slice(-2);
  else if (hasWrongAnswer(normalized)) {
    if (item) {
      item.pending = true;
      item.last = a.at;
      item.count++;
    } else
      d.reviews.push({
        note: a.note,
        level: normalized.level,
        range: normalized.range,
        secondNote: a.secondNote,
        chord: a.chord,
        first: a.at,
        last: a.at,
        count: 1,
        pending: true,
      });
  } else if (a.mode === "review" && fullyCorrect(normalized) && item)
    item.pending = false;
  return d;
}
export function shuffle<T>(items: T[], random = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// All twelve pitches once, then eight distinct extras: each pitch occurs once or twice.
export function levelOneQuestions(random = Math.random): number[] {
  const pitches = NOTES.map((_, index) => index);
  return shuffle([...pitches, ...shuffle(pitches, random).slice(0, 8)], random);
}
export function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function daily(data: Data, level?: number, range?: RangeMode) {
  const map = new Map<string, number[]>();
  for (const s of data.sessions) {
    if (
      s.status !== "complete" ||
      s.mode !== "normal" ||
      (level !== undefined && s.level !== level) ||
      (range !== undefined && (s.range ?? "high") !== range)
    )
      continue;
    const key = dayKey(s.started);
    map.set(key, [...(map.get(key) || []), score(s)]);
  }
  return [...map]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, points]) => ({
      day,
      points: points.reduce((a, b) => a + b, 0) / points.length,
      count: points.length,
    }));
}
export function analysisAttempts(
  data: Data,
  level: number,
  recent = false,
  range?: RangeMode,
): Attempt[] {
  return data.sessions
    .filter(
      (s) =>
        s.mode === "normal" &&
        s.level === level &&
        (range === undefined || (s.range ?? "high") === range),
    )
    .flatMap((s) =>
      s.attempts
        .slice(
          recent
            ? (analysisResetFor(data, level, range)?.counts[s.id] ?? 0)
            : 0,
        )
        .map((a) => ({ ...a, level: a.level ?? s.level })),
    )
    .filter((a) => !unanswered(a));
}
export function analysisResetFor(data: Data, level: number, range?: RangeMode) {
  return (
    (range ? data.analysisRangeResets?.[`${level}:${range}`] : undefined) ??
    data.analysisResets?.[level as 1 | 2 | 3]
  );
}
export function resetAnalysis(
  data: Data,
  level: 1 | 2 | 3,
  range?: RangeMode,
): Data {
  const counts = Object.fromEntries(
    data.sessions
      .filter(
        (s) =>
          s.mode === "normal" &&
          s.level === level &&
          (range === undefined || (s.range ?? "high") === range),
      )
      .map((s) => [s.id, s.attempts.length]),
  );
  if (range)
    return {
      ...data,
      analysisRangeResets: {
        ...data.analysisRangeResets,
        [`${level}:${range}`]: { at: new Date().toISOString(), counts },
      },
    };
  return {
    ...data,
    analysisResets: {
      ...data.analysisResets,
      [level]: { at: new Date().toISOString(), counts },
    },
  };
}
export function validate(value: unknown): Data {
  const d = value as Data;
  if (
    !d ||
    d.schemaVersion !== 1 ||
    !Array.isArray(d.sessions) ||
    !Array.isArray(d.reviews) ||
    !Array.isArray(d.debug)
  )
    throw Error("対応していないJSON形式です");
  if (d.sessions.length > 10000 || d.reviews.length > 612 || d.debug.length > 2)
    throw Error("データ件数が上限を超えています");
  const date = (s: unknown) =>
    typeof s === "string" && Number.isFinite(Date.parse(s));
  const note = (n: unknown) =>
    Number.isInteger(n) && Number(n) >= 0 && Number(n) < 12;
  if (
    d.settings !== undefined &&
    (!d.settings ||
      typeof d.settings !== "object" ||
      Array.isArray(d.settings) ||
      !["sharp", "flat"].includes(d.settings.notation) ||
      !Object.hasOwn(RANGES, d.settings.range))
  )
    throw Error("設定形式が不正です");
  if (d.analysisResets !== undefined) {
    if (
      !d.analysisResets ||
      typeof d.analysisResets !== "object" ||
      Array.isArray(d.analysisResets)
    )
      throw Error("分析リセット形式が不正です");
    for (const [level, reset] of Object.entries(d.analysisResets)) {
      if (
        !["1", "2", "3"].includes(level) ||
        !reset ||
        !date(reset.at) ||
        !reset.counts ||
        typeof reset.counts !== "object" ||
        Array.isArray(reset.counts) ||
        Object.entries(reset.counts).some(
          ([id, n]) =>
            id.length > 160 || !Number.isInteger(n) || n < 0 || n > 20,
        )
      )
        throw Error("分析リセット形式が不正です");
    }
  }
  if (d.analysisRangeResets !== undefined) {
    if (
      !d.analysisRangeResets ||
      typeof d.analysisRangeResets !== "object" ||
      Array.isArray(d.analysisRangeResets)
    )
      throw Error("音域別リセット形式が不正です");
    for (const [key, reset] of Object.entries(d.analysisRangeResets)) {
      if (
        !/^[123]:(high|low|bass)$/.test(key) ||
        !reset ||
        !date(reset.at) ||
        !reset.counts ||
        typeof reset.counts !== "object" ||
        Array.isArray(reset.counts) ||
        Object.entries(reset.counts).some(
          ([id, n]) =>
            id.length > 160 || !Number.isInteger(n) || n < 0 || n > 20,
        )
      )
        throw Error("音域別リセット形式が不正です");
    }
  }
  function validQuestion(
    q: { note: number; level?: Level; secondNote?: number; chord?: ChordKind },
    level: Level,
  ) {
    if (![1, 2, 3].includes(level)) return false;
    if (level === 2) return note(q.secondNote) && q.chord === undefined;
    if (level === 3)
      return Object.hasOwn(CHORDS, q.chord ?? "") && q.secondNote === undefined;
    return q.secondNote === undefined && q.chord === undefined;
  }
  const ids = new Set<string>();
  for (const s of d.sessions) {
    if (
      !s ||
      typeof s.id !== "string" ||
      s.id.length > 160 ||
      ids.has(s.id) ||
      !date(s.started) ||
      typeof s.timezone !== "string" ||
      s.timezone.length > 100 ||
      ![1, 2, 3].includes(s.level) ||
      (s.range !== undefined && !Object.hasOwn(RANGES, s.range)) ||
      !["normal", "review"].includes(s.mode) ||
      !["active", "complete", "interrupted"].includes(s.status) ||
      !Number.isInteger(s.total) ||
      s.total < 1 ||
      s.total > 612 ||
      !Array.isArray(s.attempts) ||
      s.attempts.length > s.total ||
      (s.mode === "normal" && s.total !== 20) ||
      (s.status === "complete" && s.attempts.length !== s.total) ||
      (s.ended !== undefined && !date(s.ended))
    )
      throw Error("セッション形式が不正です");
    ids.add(s.id);
    const attempts = new Set<string>();
    for (const a of s.attempts) {
      checkAttempt(a, s.level);
      if (s.mode === "normal" && (a.level ?? s.level) !== s.level)
        throw Error("回答レベルが不正です");
      if (a.sessionId !== s.id || a.mode !== s.mode || attempts.has(a.id))
        throw Error("回答の対応関係が不正です");
      attempts.add(a.id);
    }
  }
  function checkAttempt(a: Attempt, fallback: Level = 1) {
    if (
      !a ||
      typeof a.id !== "string" ||
      a.id.length > 160 ||
      !validQuestion(a, a.level ?? fallback) ||
      ((a.level ?? fallback) === 2 &&
        a.secondAnswer !== null &&
        !note(a.secondAnswer)) ||
      ((a.level ?? fallback) === 3 &&
        a.answer !== null &&
        !Object.hasOwn(CHORDS, a.answerChord ?? "")) ||
      typeof a.sessionId !== "string" ||
      a.sessionId.length > 160 ||
      !note(a.note) ||
      (a.range !== undefined && !Object.hasOwn(RANGES, a.range)) ||
      (a.answer !== null && !note(a.answer)) ||
      !date(a.at) ||
      !Number.isFinite(a.elapsed) ||
      a.elapsed < 0 ||
      !["normal", "review"].includes(a.mode)
    )
      throw Error("回答形式が不正です");
  }
  const notes = new Set<string>();
  for (const r of d.reviews) {
    if (
      !r ||
      !note(r.note) ||
      (r.range !== undefined && !Object.hasOwn(RANGES, r.range)) ||
      !validQuestion(r, r.level ?? 1) ||
      notes.has(questionKey(r)) ||
      !date(r.first) ||
      !date(r.last) ||
      !Number.isInteger(r.count) ||
      r.count < 1 ||
      typeof r.pending !== "boolean"
    )
      throw Error("復習形式が不正です");
    notes.add(questionKey(r));
  }
  for (const a of d.debug) {
    checkAttempt(a);
    if (!unanswered(a)) throw Error("未回答例が不正です");
  }
  return structuredClone(d);
}

// Reconstruct old pitch-class-only review entries using the actual recorded session ranges.
export function migrateReviews(data: Data): Data {
  if (!data.reviews.some((r) => r.range === undefined)) return data;
  const d = structuredClone(data);
  d.reviews = [];
  const history = d.sessions
    .flatMap((s) =>
      s.attempts.map((a) => ({
        ...a,
        level: a.level ?? s.level,
        range: a.range ?? s.range ?? ("high" as RangeMode),
      })),
    )
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const a of history) {
    if (unanswered(a)) continue;
    const item = d.reviews.find((r) => questionKey(r) === questionKey(a));
    if (hasWrongAnswer(a)) {
      if (item) {
        item.count++;
        item.last = a.at;
        item.pending = true;
      } else
        d.reviews.push({
          note: a.note,
          level: a.level ?? 1,
          secondNote: a.secondNote,
          chord: a.chord,
          range: a.range,
          first: a.at,
          last: a.at,
          count: 1,
          pending: true,
        });
    } else if (a.mode === "review" && fullyCorrect(a) && item)
      item.pending = false;
  }
  for (const old of data.reviews) {
    if (!d.reviews.some((r) => questionKey(r) === questionKey(old)))
      d.reviews.push({ ...old, range: old.range ?? "high" });
  }
  return d;
}

export function spokenNote(note: number, notation: "sharp" | "flat") {
  const sharp = [
    "ド",
    "ドシャープ",
    "レ",
    "レシャープ",
    "ミ",
    "ファ",
    "ファシャープ",
    "ソ",
    "ソシャープ",
    "ラ",
    "ラシャープ",
    "シ",
  ];
  const flat = [
    "ド",
    "レフラット",
    "レ",
    "ミフラット",
    "ミ",
    "ファ",
    "ソフラット",
    "ソ",
    "ラフラット",
    "ラ",
    "シフラット",
    "シ",
  ];
  return (notation === "flat" ? flat : sharp)[note];
}

export function analysisBuckets(
  attempts: Attempt[],
  level: Level,
  names: readonly string[],
) {
  const buckets =
    level === 3
      ? names.flatMap((name, note) =>
          CHORD_KINDS.map((chord) => ({ label: name + chord, note, chord })),
        )
      : names.map((label, note) => ({ label, note, chord: undefined }));
  return buckets.map((bucket) => {
    const samples =
      level === 2
        ? attempts.flatMap((a) => [
            { note: a.note, answer: a.answer },
            { note: a.secondNote!, answer: a.secondAnswer ?? null },
          ])
        : attempts;
    const answers = samples.filter(
      (a) =>
        a.note === bucket.note &&
        a.answer !== null &&
        (level !== 3 || (a as Attempt).chord === bucket.chord),
    );
    const correct = answers.filter(
      (a) =>
        a.answer === a.note &&
        (level !== 3 || (a as Attempt).answerChord === bucket.chord),
    ).length;
    return {
      ...bucket,
      total: answers.length,
      correct,
      rate: answers.length ? (correct / answers.length) * 100 : null,
    };
  });
}

export function spokenQuestion(q: Question, notation: "sharp" | "flat") {
  const root = spokenNote(q.note, notation);
  if (q.level === 2) return `${root}、${spokenNote(q.secondNote!, notation)}`;
  if (q.level === 3)
    return `${root}、${{ M7: "メジャーセブン", m7: "マイナーセブン", "7": "セブン", m7b5: "マイナーセブンフラットファイブ" }[q.chord!]}`;
  return root;
}
