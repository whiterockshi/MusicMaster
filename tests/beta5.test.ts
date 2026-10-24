import { describe, it, expect } from "vitest";
import {
  CHORD_KINDS,
  chordNotes,
  generateQuestions,
  record,
  empty,
  attemptPoints,
  fullyCorrect,
  unanswered,
  validate,
  analysisBuckets,
  NOTES,
  questionKey,
  type Session,
  type Attempt,
  type Level,
} from "../src/model";
const session = (level: Level): Session => ({
  id: "s",
  started: "2026-10-24T00:00:00Z",
  timezone: "Asia/Tokyo",
  level,
  range: "bass",
  mode: "normal",
  total: 20,
  status: "active",
  attempts: [],
});
const attempt = (fields: Partial<Attempt>): Attempt => ({
  id: "a",
  sessionId: "s",
  at: "2026-10-24T00:01:00Z",
  elapsed: 500,
  mode: "normal",
  note: 0,
  answer: 0,
  ...fields,
});
describe("Beta 5 music and scoring", () => {
  it("uses four root-position seventh chord structures over all twelve roots", () => {
    expect(chordNotes(0, "M7")).toEqual([0, 4, 7, 11]);
    expect(chordNotes(9, "m7")).toEqual([9, 12, 16, 19]);
    expect(chordNotes(0, "7")).toEqual([0, 4, 7, 10]);
    expect(chordNotes(0, "m7b5")).toEqual([0, 3, 6, 10]);
    expect(
      new Set(
        Array.from({ length: 12 }, (_, note) =>
          CHORD_KINDS.map((chord) =>
            questionKey({ note, chord, level: 3, range: "bass" }),
          ),
        ).flat(),
      ).size,
    ).toBe(48);
  });
  it("generates twenty valid level2 pairs and twenty distinct chord questions", () => {
    const pairs = generateQuestions(2, "low", () => 0);
    expect(pairs).toHaveLength(20);
    expect(new Set(pairs.map((q) => q.note)).size).toBe(12);
    expect(new Set(pairs.map((q) => q.secondNote)).size).toBe(12);
    const chords = generateQuestions(3, "high", () => 0.999);
    expect(chords).toHaveLength(20);
    expect(new Set(chords.map(questionKey)).size).toBe(20);
    for (const q of chords) expect(CHORD_KINDS).toContain(q.chord);
  });
  it("scores all two-note combinations at 0/2/5 without ordering bias", () => {
    const base = attempt({ level: 2, secondNote: 4, secondAnswer: 4 });
    expect(attemptPoints(base)).toBe(5);
    expect(attemptPoints({ ...base, answer: 1 })).toBe(2);
    expect(attemptPoints({ ...base, secondAnswer: 5 })).toBe(2);
    expect(attemptPoints({ ...base, answer: 4, secondAnswer: 0 })).toBe(0);
    expect(attemptPoints({ ...base, answer: null })).toBe(2);
    expect(unanswered({ ...base, answer: null, secondAnswer: null })).toBe(
      true,
    );
  });
  it("requires correct root and chord type and counts no partial chord score", () => {
    const a = attempt({ level: 3, chord: "M7", answerChord: "M7" });
    expect(fullyCorrect(a)).toBe(true);
    expect(attemptPoints({ ...a, answerChord: "7" })).toBe(0);
    expect(attemptPoints({ ...a, answer: 1 })).toBe(0);
  });
  it("preserves ordered pairs and chord types as separate review items and validates roundtrip", () => {
    let d = { ...empty(), sessions: [session(2)] };
    d = record(d, attempt({ level: 2, secondNote: 4, secondAnswer: 5 }));
    d = record(
      d,
      attempt({
        id: "b",
        level: 2,
        note: 4,
        answer: 0,
        secondNote: 0,
        secondAnswer: 0,
      }),
    );
    expect(d.reviews).toHaveLength(2);
    expect(validate(JSON.parse(JSON.stringify(d)))).toEqual(d);
    const invalid = structuredClone(d);
    invalid.sessions[0].attempts[0].secondNote = 30;
    expect(() => validate(invalid)).toThrow();
    let chords = { ...empty(), sessions: [session(3)] };
    chords = record(
      chords,
      attempt({ level: 3, chord: "M7", answerChord: "7" }),
    );
    chords = record(
      chords,
      attempt({ id: "b", level: 3, chord: "7", answerChord: "M7" }),
    );
    expect(chords.reviews).toHaveLength(2);
    expect(validate(chords)).toEqual(chords);
  });
  it("keeps missing answers out of review, limits debug to two and analyzes individual pair tones", () => {
    let d = { ...empty(), sessions: [session(2)] };
    for (let i = 0; i < 3; i++)
      d = record(
        d,
        attempt({
          id: String(i),
          level: 2,
          note: 0,
          answer: null,
          secondNote: 4,
          secondAnswer: null,
        }),
      );
    expect(d.reviews).toHaveLength(0);
    expect(d.debug).toHaveLength(2);
    d = record(
      d,
      attempt({
        id: "partial",
        level: 2,
        note: 0,
        answer: null,
        secondNote: 4,
        secondAnswer: 4,
      }),
    );
    expect(d.reviews).toHaveLength(0);
    const buckets = analysisBuckets(d.sessions[0].attempts, 2, NOTES);
    expect(buckets[4].rate).toBe(100);
    expect(buckets[0].rate).toBe(null);
  });
  it("analyzes all 48 chord categories independently", () => {
    const buckets = analysisBuckets(
      [
        attempt({ level: 3, chord: "M7", answerChord: "7" }),
        attempt({ level: 3, chord: "7", answerChord: "7" }),
      ],
      3,
      NOTES,
    );
    expect(buckets).toHaveLength(48);
    expect(buckets.find((b) => b.label === "CM7")?.rate).toBe(0);
    expect(buckets.find((b) => b.label === "C7")?.rate).toBe(100);
  });
});
