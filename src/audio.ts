import {
  frequency,
  questionPitches,
  midiFrequency,
  type PitchLayout,
  type RangeMode,
} from "./model";
let context: AudioContext | undefined;
export async function unlock() {
  context ??= new AudioContext();
  await context.resume();
  if (context.state !== "running")
    throw Error("音声を開始できません。再開を押してください。");
}
export function stopAudio() {
  speechGeneration++;
  const previous = context;
  context = undefined;
  if (previous && previous.state !== "closed") void previous.close();
  window.speechSynthesis?.cancel();
}
export function tone(
  frequency: number,
  duration = 0.15,
  volume = 0.07,
  offset = 0,
) {
  if (!context || context.state !== "running") return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const t = context.currentTime + offset;
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(t);
  oscillator.stop(t + duration + 0.02);
}
export const cue = () => tone(1100, 0.07, 0.025);
export const playNote = (
  note: number,
  range: RangeMode = "high",
  layout: PitchLayout = 2,
) => tone(frequency(note, range, layout), 1, 0.12);
export function feedback(correct: boolean) {
  if (correct) {
    tone(784, 0.24);
    tone(1047, 0.35, 0.07, 0.25);
  } else tone(150, 0.45, 0.06);
}
// Browser voices are populated asynchronously, especially after a cold start.
let priming: Promise<SpeechSynthesisVoice | undefined> | undefined;
let speechGeneration = 0;
export function prepareSpeech(): Promise<SpeechSynthesisVoice | undefined> {
  const api = window.speechSynthesis;
  if (!api) return Promise.resolve(undefined);
  const find = () =>
    api
      .getVoices()
      .find((v) => v.localService && v.lang.toLowerCase().startsWith("ja"));
  const ready = find();
  if (ready) return Promise.resolve(ready);
  return (priming ??= new Promise((resolve) => {
    const done = (voice?: SpeechSynthesisVoice) => {
      clearTimeout(timer);
      api.removeEventListener("voiceschanged", changed);
      resolve(voice);
    };
    const changed = () => {
      const voice = find();
      if (voice) done(voice);
    };
    const timer = setTimeout(() => done(), 2000);
    api.addEventListener("voiceschanged", changed);
    changed();
  }));
}
// Restrict speech to local voices; never fall back to an external speech service.
export async function speak(text: string): Promise<void> {
  const generation = speechGeneration;
  const voice = await prepareSpeech();
  if (!voice || generation !== speechGeneration) return;
  return new Promise((resolve) => {
    const api = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = "ja-JP";
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    u.onend = done;
    u.onerror = done;
    const timer = setTimeout(() => {
      api.cancel();
      done();
    }, 10000);
    api.speak(u);
  });
}

export function playQuestion(question: import("./model").Question): number {
  const level = question.level ?? 1;
  const pitches = questionPitches(question).map(midiFrequency);
  if (level === 1) {
    tone(pitches[0], 1, 0.12);
    return 1100;
  }
  if (level === 2) {
    tone(pitches[0], 1, 0.12);
    tone(pitches[1], 1, 0.12, 1.35);
    return 2450;
  }
  pitches.forEach((note, i) => tone(note, 0.5, 0.1, i * 0.62));
  const together = 3.16;
  pitches.forEach((note) => tone(note, 1.2, 0.03, together));
  return 4460;
}
