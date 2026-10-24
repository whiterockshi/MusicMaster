import { describe, it, expect, vi, afterEach } from "vitest";
import { prepareRecording, MAX_RECORDING_BYTES } from "../src/recording";
let stopped = 0;
class Recorder {
  static instance: Recorder;
  static isTypeSupported = () => true;
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable?: (e: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  constructor() {
    Recorder.instance = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({
        data: new Blob(["voice"], { type: this.mimeType }),
      });
      this.onstop?.();
    });
  }
}
function setup() {
  stopped = 0;
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("navigator", {
    mediaDevices: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: () => stopped++ }],
      })),
    },
  });
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("bounded optional debug recorder", () => {
  it("records only after start, retains unanswered audio and releases tracks", async () => {
    setup();
    const capture = await prepareRecording();
    expect(Recorder.instance.state).toBe("inactive");
    capture.start();
    const result = await capture.finish(true);
    expect(result.blob?.size).toBe(5);
    expect(result.status).toBe("saved");
    expect(stopped).toBeGreaterThan(0);
  });
  it("discards answered audio and cancels before start safely", async () => {
    setup();
    let capture = await prepareRecording();
    capture.start();
    expect((await capture.finish(false)).blob).toBeUndefined();
    capture = await prepareRecording();
    capture.cancel();
    capture.start();
    expect(Recorder.instance.state).toBe("inactive");
    expect(stopped).toBeGreaterThan(0);
  });
  it("discards oversize audio instead of storing a broken truncated file", async () => {
    setup();
    const capture = await prepareRecording();
    capture.start();
    Recorder.instance.ondataavailable?.({
      data: new Blob([new Uint8Array(MAX_RECORDING_BYTES + 1)]),
    });
    const result = await capture.finish(true);
    expect(result.status).toBe("over-limit");
    expect(result.blob).toBeUndefined();
  });
  it("stops at ten seconds even if the application has not finalized the question", async () => {
    vi.useFakeTimers();
    setup();
    const capture = await prepareRecording();
    capture.start();
    await vi.advanceTimersByTimeAsync(10000);
    expect(Recorder.instance.state).toBe("inactive");
    expect(stopped).toBeGreaterThan(0);
    expect((await capture.finish(true)).blob?.size).toBe(5);
  });
});
