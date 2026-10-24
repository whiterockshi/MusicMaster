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
