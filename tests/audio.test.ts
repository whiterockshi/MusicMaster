import { afterEach, describe, it, expect, vi } from "vitest";
class Utterance {
  voice: unknown;
  lang = "";
  onend?: () => void;
  onerror?: () => void;
  constructor(public text: string) {}
}
function engine() {
  let voices: SpeechSynthesisVoice[] = [];
  const api = Object.assign(new EventTarget(), {
    getVoices: vi.fn(() => voices),
    speak: vi.fn((u: Utterance) => queueMicrotask(() => u.onend?.())),
    cancel: vi.fn(),
  });
  vi.stubGlobal("window", { speechSynthesis: api });
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  return {
    api,
    ready: () => {
      voices = [{ localService: true, lang: "ja-JP" } as SpeechSynthesisVoice];
      api.dispatchEvent(new Event("voiceschanged"));
    },
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});
describe("cold-start Japanese voice readiness", () => {
  it("waits for initially empty voices before announcing the first question", async () => {
    vi.useFakeTimers();
    const mock = engine();
    const audio = await import("../src/audio");
    const pending = audio.speak("第1問");
    expect(mock.api.speak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    mock.ready();
    await pending;
    expect(mock.api.speak.mock.calls[0][0].text).toBe("第1問");
  });
  it("bounds missing-voice wait and can discover a later-installed local voice", async () => {
    vi.useFakeTimers();
    const mock = engine();
    const audio = await import("../src/audio");
    const pending = audio.speak("第1問");
    await vi.advanceTimersByTimeAsync(2000);
    await pending;
    expect(mock.api.speak).not.toHaveBeenCalled();
    await audio.speak("第2問");
    mock.ready();
    await audio.speak("第3問");
    expect(mock.api.speak.mock.calls[0][0].text).toBe("第3問");
  });
  it("cancels queued speech when paused while waiting for voices", async () => {
    vi.useFakeTimers();
    const mock = engine();
    const audio = await import("../src/audio");
    const pending = audio.speak("第1問");
    audio.stopAudio();
    mock.ready();
    await pending;
    expect(mock.api.speak).not.toHaveBeenCalled();
  });
});

it("raises every Lv3 tone one octave while preserving notation and Lv1/2 output", async () => {
  const played: number[] = [];
  class Context {
    state = "running";
    currentTime = 0;
    destination = {};
    resume = async () => {};
    createOscillator() {
      const oscillator = {
        type: "sine",
        frequency: { value: 0 },
        connect: () => {},
        start: () => played.push(oscillator.frequency.value),
        stop: () => {},
      };
      return oscillator;
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        connect: () => {},
      };
    }
  }
  vi.stubGlobal("AudioContext", Context);
  const audio = await import("../src/audio");
  const { questionPitches, midiLabel, midiFrequency } =
    await import("../src/model");
  await audio.unlock();
  const q = {
    level: 3 as const,
    note: 11,
    chord: "m7b5" as const,
    range: "bass" as const,
    layout: 2 as const,
  };
  expect(questionPitches(q).map((n) => midiLabel(n))).toEqual([
    "B1",
    "D3",
    "F3",
    "A3",
  ]);
  audio.playQuestion(q);
  const expected = [123.47082531, 293.66476792, 349.22823143, 440];
  expect(played).toHaveLength(8);
  played.forEach((hz, i) => expect(hz).toBeCloseTo(expected[i % 4], 5));
  played.length = 0;
  audio.playQuestion({ ...q, level: 1, chord: undefined });
  expect(played[0]).toBeCloseTo(midiFrequency(35), 5);
  played.length = 0;
  audio.playQuestion({
    level: 2,
    note: 11,
    secondNote: 0,
    range: "bass",
    layout: 2,
  });
  expect(played).toEqual([midiFrequency(35), midiFrequency(36)]);
});
