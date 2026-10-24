import { describe, it, expect } from "vitest";
import {
  empty,
  record,
  score,
  daily,
  validate,
  shuffle,
  levelOneQuestions,
  type Session,
  type Attempt,
} from "../src/model";
const s = (): Session => ({
  id: "s",
  started: "2026-10-24T05:00:00Z",
  timezone: "Asia/Tokyo",
  status: "active",
  mode: "normal",
  total: 20,
  level: 1,
  attempts: [],
});
const a = (
  id: string,
  note = 0,
  answer: number | null = 1,
  mode: "normal" | "review" = "normal",
): Attempt => ({
  id,
  sessionId: "s",
  note,
  answer,
  at: "2026-10-24T05:01:00Z",
  elapsed: 500,
  mode,
});
const setup = () => ({ ...empty(), sessions: [s()] });
describe("scoring and review lifecycle", () => {
  it("scores 20 correct answers at 100 and ignores duplicate events", () => {
    let d = setup();
    for (let i = 0; i < 20; i++) d = record(d, a(String(i), i % 12, i % 12));
    d = record(d, a("0", 0, 0));
    expect(score(d.sessions[0])).toBe(100);
    expect(d.sessions[0].attempts).toHaveLength(20);
    expect(d.reviews).toHaveLength(0);
  });
  it("deduplicates pending notes, resolves only in review, retains history, reopens on error", () => {
    let d = record(setup(), a("1"));
    d = record(d, a("2"));
    expect(d.reviews[0].count).toBe(2);
    d = record(d, a("3", 0, 0));
    expect(d.reviews[0].pending).toBe(true);
    d.sessions[0].mode = "review";
    d = record(d, a("4", 0, 0, "review"));
    expect(d.reviews[0].pending).toBe(false);
    expect(d.sessions[0].attempts).toHaveLength(4);
    d = record(d, a("5", 0, 1, "review"));
    expect(d.reviews[0].pending).toBe(true);
  });
  it("does not add unanswered to review and evicts oldest debug example", () => {
    let d = setup();
    for (let i = 0; i < 3; i++) d = record(d, a(String(i), i, null));
    expect(d.debug.map((x) => x.id)).toEqual(["1", "2"]);
    expect(d.reviews).toEqual([]);
    expect(score(d.sessions[0])).toBe(0);
  });
  it("keeps existing review item pending when unanswered", () => {
    let d = record(setup(), a("1"));
    d.sessions[0].mode = "review";
    d = record(d, a("2", 0, null, "review"));
    expect(d.reviews[0].pending).toBe(true);
  });
  it("does not record into completed sessions", () => {
    const d = setup();
    d.sessions[0].status = "interrupted";
    expect(record(d, a("1")).sessions[0].attempts).toHaveLength(0);
  });
});
describe("history aggregation and validation", () => {
  it("excludes interrupted and review sessions from daily graph", () => {
    const d = setup();
    d.sessions[0].status = "complete";
    d.sessions[0].attempts = [a("1", 0, 0)];
    d.sessions.push({
      ...s(),
      id: "review",
      status: "complete",
      mode: "review",
    });
    d.sessions.push({ ...s(), id: "stop", status: "interrupted" });
    expect(daily(d)).toEqual([{ day: "2026-10-24", points: 5, count: 1 }]);
  });
  it("accepts valid roundtrip and rejects malformed notes, repeated ids, and invalid scores", () => {
    const d = record(setup(), a("1"));
    expect(validate(JSON.parse(JSON.stringify(d)))).toEqual(d);
    const bad = structuredClone(d);
    bad.sessions[0].attempts[0].note = 99;
    expect(() => validate(bad)).toThrow();
    expect(() => validate({ ...d, sessions: [s(), s()] })).toThrow();
    expect(() => validate({ schemaVersion: 2 })).toThrow();
  });
  it("shuffles without losing any pending item or mutating input", () => {
    const input = [0, 1, 2, 3];
    expect(shuffle(input, () => 0).sort()).toEqual(input);
    expect(input).toEqual([0, 1, 2, 3]);
  });
});

describe("Lv1 session coverage", () => {
  it("always includes all twelve pitches in twenty questions with at most two of each", () => {
    for (const random of [() => 0, () => 0.999999, Math.random]) {
      for (let run = 0; run < 50; run++) {
        const questions = levelOneQuestions(random);
        expect(questions).toHaveLength(20);
        expect(new Set(questions).size).toBe(12);
        const counts = Array.from(
          { length: 12 },
          (_, n) => questions.filter((q) => q === n).length,
        );
        expect(counts.filter((n) => n === 2)).toHaveLength(8);
        expect(counts.filter((n) => n === 1)).toHaveLength(4);
      }
    }
  });
});

describe("settings and analysis reset", () => {
  it("supports old backups and preserves settings and reset markers in new backups", async () => {
    const { resetAnalysis, DEFAULT_SETTINGS } = await import("../src/model");
    expect(validate(setup()).settings).toBeUndefined();
    for (const invalid of [null, false, [], 42]) {
      expect(() => validate({ ...setup(), settings: invalid })).toThrow();
      expect(() => validate({ ...setup(), analysisResets: invalid })).toThrow();
    }
    const d = resetAnalysis(
      {
        ...setup(),
        settings: { ...DEFAULT_SETTINGS, range: "bass", notation: "flat" },
      },
      1,
    );
    expect(validate(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(() =>
      validate({ ...d, settings: { range: "invalid", notation: "flat" } }),
    ).toThrow();
    expect(() =>
      validate({ ...d, analysisResets: { 1: { at: "bad", counts: {} } } }),
    ).toThrow();
  });
  it("resets only recent statistics and includes new answers in an existing session even at the same timestamp", async () => {
    const { resetAnalysis, analysisAttempts } = await import("../src/model");
    let d = record(setup(), a("one", 1, 1));
    d = resetAnalysis(d, 1);
    expect(analysisAttempts(d, 1)).toHaveLength(1);
    expect(analysisAttempts(d, 1, true)).toHaveLength(0);
    d = record(d, a("two", 1, 0));
    expect(analysisAttempts(d, 1)).toHaveLength(2);
    expect(analysisAttempts(d, 1, true).map((a) => a.id)).toEqual(["two"]);
    const reset = resetAnalysis(d, 1);
    expect(analysisAttempts(reset, 1, true)).toHaveLength(0);
    expect(reset.sessions).toEqual(d.sessions);
    expect(reset.reviews).toEqual(d.reviews);
  });
  it("synthesizes each range one octave apart without changing pitch class", async () => {
    const { frequency } = await import("../src/model");
    for (let note = 0; note < 12; note++) {
      expect(frequency(note, "high")).toBeCloseTo(frequency(note, "low") * 2);
      expect(frequency(note, "low")).toBeCloseTo(frequency(note, "bass") * 2);
    }
    expect(frequency(9, "high", 1)).toBe(440);
    expect(frequency(0, "bass", 1)).toBeCloseTo(65.4064, 3);
  });
});

describe("range-aware review and statistics", () => {
  it("separates same pitch by range and resolves only the original range", () => {
    let d = setup();
    d.sessions.push({ ...s(), id: "bass", range: "bass" });
    d = record(d, a("high-error", 9, 0));
    d = record(d, { ...a("bass-error", 9, 0), sessionId: "bass" });
    expect(d.reviews).toHaveLength(2);
    d.sessions.push({
      ...s(),
      id: "review",
      mode: "review",
      total: 2,
      range: "high",
    });
    d = record(d, {
      ...a("review-bass", 9, 9, "review"),
      sessionId: "review",
      range: "bass",
    });
    expect(d.reviews.find((r) => r.range === "bass")?.pending).toBe(false);
    expect(d.reviews.find((r) => r.range === "high")?.pending).toBe(true);
  });
  it("rebuilds legacy review entries from actual session ranges and preserves solved history", async () => {
    const { migrateReviews } = await import("../src/model");
    const d = setup();
    d.sessions[0].attempts = [a("high-error", 9, 0)];
    d.sessions.push({
      ...s(),
      id: "bass",
      range: "bass",
      attempts: [{ ...a("bass-error", 9, 0), sessionId: "bass" }],
    });
    d.sessions.push({
      ...s(),
      id: "review",
      mode: "review",
      attempts: [
        {
          ...a("solved", 9, 9, "review"),
          sessionId: "review",
          at: "2026-10-24T06:00:00Z",
        },
      ],
    });
    d.reviews = [
      {
        note: 9,
        first: "2026-10-24T05:01:00Z",
        last: "2026-10-24T05:01:00Z",
        count: 2,
        pending: false,
      },
    ];
    const upgraded = migrateReviews(validate(d));
    expect(upgraded.reviews.find((r) => r.range === "high")?.pending).toBe(
      false,
    );
    expect(upgraded.reviews.find((r) => r.range === "bass")?.pending).toBe(
      true,
    );
    expect(migrateReviews(upgraded)).toEqual(upgraded);
    expect(validate(upgraded)).toEqual(upgraded);
  });
  it("separates graph, analysis and reset by range, retaining legacy reset boundaries", async () => {
    const { analysisAttempts, resetAnalysis } = await import("../src/model");
    const d = setup();
    d.sessions[0].status = "complete";
    d.sessions[0].attempts = [a("high", 0, 0)];
    d.sessions.push({
      ...s(),
      id: "bass",
      range: "bass",
      status: "complete",
      attempts: [{ ...a("bass", 0, 1), sessionId: "bass" }],
    });
    expect(daily(d, 1, "high")[0].points).toBe(5);
    expect(daily(d, 1, "bass")[0].points).toBe(0);
    expect(daily(d, 2, "bass")).toEqual([]);
    const reset = resetAnalysis(d, 1, "bass");
    expect(analysisAttempts(reset, 1, true, "bass")).toHaveLength(0);
    expect(analysisAttempts(reset, 1, true, "high")).toHaveLength(1);
    expect(analysisAttempts(resetAnalysis(d, 1), 1, true, "bass")).toHaveLength(
      0,
    );
  });
});
