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
  high: { label: "Hiギター", octave: 4 },
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
export type Attempt = {
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
  level: 1;
  range?: RangeMode;
  attempts: Attempt[];
};
export type Review = {
  note: number;
  first: string;
  last: string;
  count: number;
  pending: boolean;
};
export type Data = {
  schemaVersion: 1;
  settings?: Settings;
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
  s.attempts.filter((a) => a.answer === a.note).length * 5;
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
  session.attempts.push(a);
  const item = d.reviews.find((r) => r.note === a.note);
  if (a.answer === null) d.debug = [...d.debug, a].slice(-2);
  else if (a.answer !== a.note) {
    if (item) {
      item.pending = true;
      item.last = a.at;
      item.count++;
    } else
      d.reviews.push({
        note: a.note,
        first: a.at,
        last: a.at,
        count: 1,
        pending: true,
      });
  } else if (a.mode === "review" && item) item.pending = false;
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
export function daily(data: Data) {
  const map = new Map<string, number[]>();
  for (const s of data.sessions) {
    if (s.status !== "complete" || s.mode !== "normal") continue;
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
): Attempt[] {
  return data.sessions
    .filter((s) => s.mode === "normal" && s.level === level)
    .flatMap((s) =>
      s.attempts.slice(
        recent
          ? (data.analysisResets?.[level as 1 | 2 | 3]?.counts[s.id] ?? 0)
          : 0,
      ),
    )
    .filter((a) => a.answer !== null);
}
export function resetAnalysis(data: Data, level: 1 | 2 | 3): Data {
  const counts = Object.fromEntries(
    data.sessions
      .filter((s) => s.mode === "normal" && s.level === level)
      .map((s) => [s.id, s.attempts.length]),
  );
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
  if (d.sessions.length > 10000 || d.reviews.length > 12 || d.debug.length > 2)
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
      s.level !== 1 ||
      (s.range !== undefined && !Object.hasOwn(RANGES, s.range)) ||
      !["normal", "review"].includes(s.mode) ||
      !["active", "complete", "interrupted"].includes(s.status) ||
      !Number.isInteger(s.total) ||
      s.total < 1 ||
      s.total > 20 ||
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
      checkAttempt(a);
      if (a.sessionId !== s.id || a.mode !== s.mode || attempts.has(a.id))
        throw Error("回答の対応関係が不正です");
      attempts.add(a.id);
    }
  }
  function checkAttempt(a: Attempt) {
    if (
      !a ||
      typeof a.id !== "string" ||
      a.id.length > 160 ||
      typeof a.sessionId !== "string" ||
      a.sessionId.length > 160 ||
      !note(a.note) ||
      (a.answer !== null && !note(a.answer)) ||
      !date(a.at) ||
      !Number.isFinite(a.elapsed) ||
      a.elapsed < 0 ||
      !["normal", "review"].includes(a.mode)
    )
      throw Error("回答形式が不正です");
  }
  const notes = new Set<number>();
  for (const r of d.reviews) {
    if (
      !r ||
      !note(r.note) ||
      notes.has(r.note) ||
      !date(r.first) ||
      !date(r.last) ||
      !Number.isInteger(r.count) ||
      r.count < 1 ||
      typeof r.pending !== "boolean"
    )
      throw Error("復習形式が不正です");
    notes.add(r.note);
  }
  for (const a of d.debug) {
    checkAttempt(a);
    if (a.answer !== null) throw Error("未回答例が不正です");
  }
  return structuredClone(d);
}
