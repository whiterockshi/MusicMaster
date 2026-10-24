export const MAX_RECORDING_BYTES = 1024 * 1024;
export const MAX_RECORDING_MS = 10000;
export type RecordingResult = {
  blob?: Blob;
  status: "saved" | "empty" | "over-limit" | "unavailable" | "error";
};
export interface RecordingCapture {
  start(): void;
  finish(keep: boolean): Promise<RecordingResult>;
  cancel(): void;
}
export async function prepareRecording(): Promise<RecordingCapture> {
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === "undefined"
  )
    throw Error("このブラウザではデバッグ録音を利用できません。");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  let recorder: MediaRecorder;
  try {
    const mime = [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  let chunks: Blob[] = [];
  let bytes = 0;
  let overflow = false;
  let failed = false;
  let stopped = false;
  let cancelled = false;
  let started = false;
  let stopRequested = false;
  let result: Blob | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tracks = () => stream.getTracks().forEach((t) => t.stop());
  let complete: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const done = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    tracks();
    if (!overflow && !failed && !cancelled)
      result = new Blob(chunks, {
        type:
          recorder.mimeType || chunks[0]?.type || "application/octet-stream",
      });
    chunks = [];
    complete();
  };
  const stop = () => {
    clearTimeout(timer);
    if (!started) {
      done();
      return;
    }
    if (stopRequested || stopped) return;
    stopRequested = true;
    if (recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        failed = true;
        done();
      }
    }
  };
  recorder.ondataavailable = (event) => {
    if (cancelled || overflow || stopped) return;
    if (bytes + event.data.size > MAX_RECORDING_BYTES) {
      overflow = true;
      chunks = [];
      stop();
      return;
    }
    bytes += event.data.size;
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onstop = done;
  recorder.onerror = () => {
    failed = true;
    stop();
  };
  return {
    start() {
      if (cancelled || started) return;
      started = true;
      try {
        recorder.start(200);
        timer = setTimeout(stop, MAX_RECORDING_MS);
      } catch {
        failed = true;
        done();
      }
    },
    async finish(keep) {
      if (!keep) {
        cancelled = true;
        chunks = [];
      }
      stop();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        finished,
        new Promise<void>((resolve) => {
          deadline = setTimeout(() => {
            failed = true;
            tracks();
            done();
            resolve();
          }, 1500);
        }),
      ]);
      clearTimeout(deadline);
      const blob = result;
      result = undefined;
      return {
        blob: keep && blob && blob.size > 0 ? blob : undefined,
        status: overflow
          ? "over-limit"
          : failed
            ? "error"
            : blob?.size
              ? "saved"
              : "empty",
      };
    },
    cancel() {
      cancelled = true;
      chunks = [];
      result = undefined;
      stop();
      tracks();
    },
  };
}
