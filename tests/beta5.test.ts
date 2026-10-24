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
  it("generates ten different-tone pairs and five distinct chord questions", () => {
    const pairs = generateQuestions(2, "low", () => 0);
    expect(pairs).toHaveLength(10);
    for (const q of pairs) expect(q.note).not.toBe(q.secondNote);
    const chords = generateQuestions(3, "high", () => 0.999);
    expect(chords).toHaveLength(5);
    expect(new Set(chords.map(questionKey)).size).toBe(5);
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

describe("short sessions and pitch regression", () => {
  it("keeps legacy 20-question sessions readable and accepts new lengths", () => {
    for (const level of [2, 3] as const) {
      for (const total of [level === 2 ? 10 : 5, 20])
        expect(
          validate({ ...empty(), sessions: [{ ...session(level), total }] })
            .sessions[0].total,
        ).toBe(total);
    }
  });
  it("checks High guitar G4 against G sharp and normalizes chart scores", async () => {
    const { frequency, daily } = await import("../src/model");
    expect(frequency(7, "high", 1)).toBeCloseTo(391.99543598, 6);
    expect(frequency(8, "high", 1)).toBeCloseTo(415.30469758, 6);
    const s = {
      ...session(3),
      total: 5,
      status: "complete" as const,
      attempts: Array.from({ length: 5 }, (_, i) =>
        attempt({
          id: String(i),
          level: 3,
          chord: "M7" as const,
          answerChord: "M7" as const,
        }),
      ),
    };
    expect(daily({ ...empty(), sessions: [s] }, 3, "bass")[0].points).toBe(100);
  });
});

describe("E-based ranges and split chord voicing", () => {
  it("places twelve pitch classes from E through Eb, with A4 at 440Hz", async () => {
    const { pitchMidi, midiFrequency } = await import("../src/model");
    for (const [range, min] of [
      ["bass", 28],
      ["low", 40],
      ["high", 52],
    ] as const) {
      const midis = Array.from({ length: 12 }, (_, n) =>
        pitchMidi(n, range, 2),
      );
      expect([...midis].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 12 }, (_, i) => min + i),
      );
    }
    expect(midiFrequency(69)).toBe(440);
  });
  it("voices CM7 as C2 E3 G3 B3 and applies the split across all 48 chords", async () => {
    const { questionPitches, midiLabel, CHORDS, pitchMidi } =
      await import("../src/model");
    expect(
      questionPitches({
        level: 3,
        note: 0,
        chord: "M7",
        range: "bass",
        layout: 2,
      }).map((n) => midiLabel(n)),
    ).toEqual(["C2", "E3", "G3", "B3"]);
    for (let note = 0; note < 12; note++)
      for (const chord of CHORD_KINDS) {
        const pitches = questionPitches({
          level: 3,
          note,
          chord,
          range: "bass",
          layout: 2,
        });
        expect(pitches[0]).toBe(pitchMidi(note, "bass", 2));
        expect(pitches.slice(1).map((n) => n - pitches[0])).toEqual(
          CHORDS[chord].slice(1).map((n) => n + 12),
        );
      }
  });
  it("keeps legacy sound, review identities and JSON separate from the new layout", async () => {
    const { questionPitches } = await import("../src/model");
    const old = { level: 1 as const, note: 7, range: "high" as const };
    const current = { ...old, layout: 2 as const };
    expect(questionPitches(old)).toEqual([67]);
    expect(questionPitches(current)).toEqual([55]);
    expect(questionKey(old)).not.toBe(questionKey(current));
    let d = { ...empty(), sessions: [session(1)] };
    d = record(d, attempt({ note: 7, answer: 0 }));
    d.sessions.push({ ...session(1), id: "new", layout: 2 });
    d = record(
      d,
      attempt({
        id: "new-answer",
        sessionId: "new",
        note: 7,
        answer: 0,
        layout: 2,
      }),
    );
    expect(d.reviews).toHaveLength(2);
    expect(validate(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });
  it("does not invent a high-range duplicate from a bass-only legacy mistake", async () => {
    const { migrateReviews } = await import("../src/model");
    const d = {
      ...empty(),
      sessions: [session(1)],
      reviews: [
        {
          note: 9,
          first: "2026-10-24T00:01:00Z",
          last: "2026-10-24T00:01:00Z",
          count: 1,
          pending: true,
        },
      ],
    };
    d.sessions[0].attempts = [attempt({ note: 9, answer: 0 })];
    const upgraded = migrateReviews(validate(d));
    expect(upgraded.reviews).toHaveLength(1);
    expect(upgraded.reviews[0].range).toBe("bass");
  });
});
