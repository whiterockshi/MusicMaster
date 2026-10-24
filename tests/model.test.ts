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
