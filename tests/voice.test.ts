import { describe, it, expect, afterEach, vi } from "vitest";
import {
  parseVoice,
  classifyAlternatives,
  VoiceListener,
  type RecognitionLike,
  voiceSupport,
} from "../src/voice";
import { CHORD_KINDS } from "../src/model";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("bounded music speech parsing", () => {
  it("normalizes solfege, sharp/flat enharmonics and kana without using a correct answer", () => {
    for (const [text, note] of [
      ["ド", 0],
      ["ど", 0],
      ["レフラット", 1],
      ["ド シャープ", 1],
      ["ファ♯", 6],
      ["シフラット", 10],
      ["ミシャープ", 5],
      ["Cb", 11],
      ["C#", 1],
      ["シー", 11],
    ] as const)
      expect(parseVoice(text, 1)?.notes).toEqual([note]);
  });
  it("handles two ordered pitches or one partial utterance but rejects extra notes", () => {
    expect(parseVoice("ど、れ", 2)?.notes).toEqual([0, 2]);
    expect(parseVoice("ソ", 2)?.notes).toEqual([7]);
    expect(parseVoice("レ ド", 2)?.notes).toEqual([2, 0]);
    expect(parseVoice("ドレミ", 2)).toBeUndefined();
  });
  it("classifies all 48 codes and preserves major versus minor", () => {
    const notes = [
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
    const suffix = [
      "メジャーセブン",
      "マイナーセブン",
      "セブン",
      "マイナーセブンフラットファイブ",
    ];
    for (let n = 0; n < 12; n++)
      suffix.forEach((name, i) =>
        expect(parseVoice(notes[n] + name, 3)).toEqual({
          notes: [n],
          chord: CHORD_KINDS[i],
        }),
      );
    expect(parseVoice("CM7", 3)?.chord).toBe("M7");
    expect(parseVoice("Cm7", 3)?.chord).toBe("m7");
    expect(parseVoice("ド エムセブン", 3)).toBeUndefined();
    expect(parseVoice("CtoString", 3)).toBeUndefined();
    expect(parseVoice("Cconstructor", 3)).toBeUndefined();
  });
  it("does not force noise, prose or conflicting alternatives into a class", () => {
    for (const text of [
      "",
      "風の音",
      "今日はドです",
      "ドレ",
      "ドシャープシャープ",
      "メジャーセブン",
      "ド".repeat(161),
    ])
      expect(parseVoice(text, 1)).toBeUndefined();
    expect(classifyAlternatives(["ドシャープ", "レフラット"], 1)).toEqual({
      status: "valid",
      answer: { notes: [1] },
    });
    expect(classifyAlternatives(["ド", "レ"], 1)).toEqual({
      status: "ambiguous",
    });
    expect(classifyAlternatives(["noise"], 1)).toEqual({ status: "unknown" });
  });
});
class Recognition implements RecognitionLike {
  static instances: Recognition[] = [];
  lang = "";
  continuous = true;
  interimResults = true;
  maxAlternatives = 0;
  onstart: RecognitionLike["onstart"] = null;
  onend: RecognitionLike["onend"] = null;
  onerror: RecognitionLike["onerror"] = null;
  onresult: RecognitionLike["onresult"] = null;
  start = vi.fn(() => {
    Recognition.instances.push(this);
    this.onstart?.(new Event("start"));
  });
  abort = vi.fn();
}
function browser() {
  Recognition.instances = [];
  vi.stubGlobal("window", {
    isSecureContext: true,
    webkitSpeechRecognition: Recognition,
  });
}
describe("speech recognition lifecycle", () => {
  it("uses prefixed APIs, only final results, suppresses duplicate indices and stops late callbacks", () => {
    browser();
    const listener = new VoiceListener();
    const text = vi.fn();
    listener.start({ onReady: vi.fn(), onText: text, onError: vi.fn() });
    const r = Recognition.instances[0];
    expect(r.lang).toBe("ja-JP");
    expect(r.interimResults).toBe(false);
    const event = {
      resultIndex: 0,
      results: [{ isFinal: false, length: 1, 0: { transcript: "ド" } }],
    };
    r.onresult?.(event);
    expect(text).not.toHaveBeenCalled();
    event.results[0].isFinal = true;
    r.onresult?.(event);
    r.onresult?.(event);
    expect(text).toHaveBeenCalledTimes(1);
    listener.stop();
    expect(r.abort).toHaveBeenCalled();
    expect(r.onresult).toBe(null);
  });
  it("restarts only a bounded number of times and cancels restarts on stop", async () => {
    vi.useFakeTimers();
    browser();
    const listener = new VoiceListener();
    listener.start({ onReady: vi.fn(), onText: vi.fn(), onError: vi.fn() });
    for (let i = 0; i < 6; i++) {
      Recognition.instances.at(-1)?.onend?.(new Event("end"));
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(Recognition.instances).toHaveLength(4);
    listener.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(Recognition.instances).toHaveLength(4);
  });
  it("treats permission and network errors as fatal and handles unavailable APIs", () => {
    browser();
    const listener = new VoiceListener();
    const error = vi.fn();
    listener.start({ onReady: vi.fn(), onText: vi.fn(), onError: error });
    Recognition.instances[0].onerror?.({ error: "not-allowed" });
    expect(error).toHaveBeenCalledWith("not-allowed", true);
    vi.stubGlobal("window", { isSecureContext: false });
    expect(voiceSupport()).toContain("HTTPS");
  });
});

it("keeps unanswered details only in the two-item FIFO and validates voice metadata bounds", async () => {
  const { empty, record, validate } = await import("../src/model");
  const session = {
    id: "voice",
    started: "2026-10-24T00:00:00Z",
    timezone: "Asia/Tokyo",
    status: "active" as const,
    total: 20,
    mode: "normal" as const,
    level: 1 as const,
    attempts: [],
  };
  let d = { ...empty(), sessions: [session] };
  d = record(d, {
    id: "a",
    sessionId: "voice",
    note: 0,
    answer: null,
    at: "2026-10-24T00:01:00Z",
    elapsed: 8000,
    mode: "normal",
    inputMode: "voice",
    recognizedText: "風の音",
    voiceError: "unknown",
    recordingStatus: "saved",
    recordingBytes: 100,
    recordingMime: "audio/webm",
  });
  expect(d.sessions[0].attempts[0].recognizedText).toBeUndefined();
  expect(d.debug[0].recognizedText).toBe("風の音");
  expect(validate(d)).toEqual(d);
  const invalid = structuredClone(d);
  invalid.debug[0].recognizedText = "x".repeat(161);
  expect(() => validate(invalid)).toThrow();
  invalid.debug[0].recognizedText = "noise";
  invalid.debug[0].recordingBytes = 1048577;
  expect(() => validate(invalid)).toThrow();
});
