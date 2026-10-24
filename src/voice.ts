import type { ChordKind, Level } from "./model";
export type VoiceAnswer = { notes: number[]; chord?: ChordKind };
export type ParsedVoice =
  | { status: "valid"; answer: VoiceAnswer }
  | { status: "unknown" | "ambiguous" };
const SOLFEGE: Record<string, number> = {
  ド: 0,
  レ: 2,
  ミ: 4,
  ファ: 5,
  ソ: 7,
  ラ: 9,
  シ: 11,
};
const LETTERS: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};
function normalize(raw: string) {
  return raw
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s、。，,.・:：;；!?！？「」『』（）()]/g, "")
    .replace(/シャープ|♯/g, "#")
    .replace(/フラット|♭/g, "b");
}
function readNote(text: string): { note: number; rest: string } | undefined {
  const match = /^(ファ|ド|レ|ミ|ソ|ラ|シ|[A-Ga-g])ー?([#b]?)/.exec(text);
  if (!match) return;
  const base = SOLFEGE[match[1]] ?? LETTERS[match[1].toUpperCase()];
  return {
    note: (base + (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0) + 12) % 12,
    rest: text.slice(match[0].length),
  };
}
export function parseVoice(raw: string, level: Level): VoiceAnswer | undefined {
  if (!raw || raw.length > 160) return;
  const text = normalize(raw);
  const first = readNote(text);
  if (!first) return;
  if (level === 1)
    return first.rest === "" ? { notes: [first.note] } : undefined;
  if (level === 2) {
    if (!first.rest) return { notes: [first.note] };
    const second = readNote(first.rest);
    return second && second.rest === ""
      ? { notes: [first.note, second.note] }
      : undefined;
  }
  const suffix = first.rest;
  const chords: Record<string, ChordKind> = {
    メジャーセブン: "M7",
    メジャーセブンス: "M7",
    メジャー7: "M7",
    M7: "M7",
    maj7: "M7",
    MAJ7: "M7",
    マイナーセブン: "m7",
    マイナーセブンス: "m7",
    マイナー7: "m7",
    m7: "m7",
    セブン: "7",
    セブンス: "7",
    "7": "7",
    マイナーセブンbファイブ: "m7b5",
    マイナーセブンb5: "m7b5",
    マイナー7b5: "m7b5",
    マイナー7bファイブ: "m7b5",
    m7b5: "m7b5",
    ハーフディミニッシュ: "m7b5",
  };
  const chord = Object.hasOwn(chords, suffix) ? chords[suffix] : undefined;
  return chord ? { notes: [first.note], chord } : undefined;
}
export function classifyAlternatives(
  alternatives: string[],
  level: Level,
): ParsedVoice {
  const valid = alternatives
    .map((text) => parseVoice(text, level))
    .filter((answer): answer is VoiceAnswer => !!answer);
  const distinct = new Map(
    valid.map((answer) => [JSON.stringify(answer), answer]),
  );
  if (distinct.size === 0) return { status: "unknown" };
  if (distinct.size > 1) return { status: "ambiguous" };
  return { status: "valid", answer: distinct.values().next().value! };
}
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: ((event: Event) => void) | null;
  onend: ((event: Event) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{
          isFinal: boolean;
          length: number;
          [index: number]: { transcript: string };
        }>;
      }) => void)
    | null;
  start(): void;
  abort(): void;
}
type RecognitionConstructor = new () => RecognitionLike;
export function recognitionConstructor(): RecognitionConstructor | undefined {
  const browser = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
}
export function voiceSupport(): string | undefined {
  if (!window.isSecureContext)
    return "音声入力にはHTTPSまたはPCのlocalhostが必要です。";
  if (!recognitionConstructor())
    return "このブラウザは音声認識に対応していません。ボタン回答を利用してください。";
}
export function voiceErrorMessage(code: string) {
  return (
    {
      "not-allowed": "マイクまたは音声認識の許可がありません。",
      "service-not-allowed": "ブラウザの音声認識サービスを利用できません。",
      "audio-capture":
        "マイクを利用できません。接続・OS設定を確認してください。",
      network:
        "音声認識の通信に失敗しました。ネット接続とブラウザ設定を確認してください。",
      "language-not-supported": "日本語の音声認識に対応していません。",
      "no-speech": "声が認識されませんでした。",
      aborted: "音声入力を中断しました。",
      "start-timeout": "音声認識の開始を確認できませんでした。",
    }[code] ?? "音声認識に失敗しました。"
  );
}
export class VoiceListener {
  private active = false;
  private recognition?: RecognitionLike;
  private restart?: ReturnType<typeof setTimeout>;
  private startup?: ReturnType<typeof setTimeout>;
  private starts = 0;
  start(callbacks: {
    onReady: () => void;
    onText: (texts: string[]) => void;
    onError: (code: string, fatal: boolean) => void;
  }) {
    this.stop();
    this.active = true;
    this.starts = 0;
    this.startup = setTimeout(() => {
      if (this.active) {
        this.stop();
        callbacks.onError("start-timeout", true);
      }
    }, 15000);
    const run = () => {
      if (!this.active) return;
      const Constructor = recognitionConstructor();
      if (!Constructor) {
        this.stop();
        callbacks.onError("service-not-allowed", true);
        return;
      }
      let r: RecognitionLike;
      try {
        r = new Constructor();
      } catch {
        this.stop();
        callbacks.onError("service-not-allowed", true);
        return;
      }
      this.recognition = r;
      this.starts++;
      const processed = new Set<number>();
      r.lang = "ja-JP";
      r.continuous = false;
      r.interimResults = false;
      r.maxAlternatives = 5;
      r.onstart = () => {
        if (!this.active || this.recognition !== r) return;
        clearTimeout(this.startup);
        callbacks.onReady();
      };
      r.onresult = (event) => {
        if (!this.active || this.recognition !== r) return;
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          if (!result.isFinal || processed.has(i)) continue;
          processed.add(i);
          callbacks.onText(
            Array.from({ length: Math.min(result.length, 5) }, (_, n) =>
              result[n].transcript.slice(0, 160),
            ),
          );
        }
      };
      r.onerror = (event) => {
        if (!this.active || this.recognition !== r) return;
        const fatal = !["no-speech", "aborted"].includes(event.error);
        if (fatal) this.stop();
        callbacks.onError(event.error, fatal);
      };
      r.onend = () => {
        if (!this.active || this.recognition !== r) return;
        if (this.starts < 4) this.restart = setTimeout(run, 250);
      };
      try {
        r.start();
      } catch {
        this.stop();
        callbacks.onError("service-not-allowed", true);
      }
    };
    run();
  }
  stop() {
    this.active = false;
    clearTimeout(this.restart);
    clearTimeout(this.startup);
    const r = this.recognition;
    this.recognition = undefined;
    if (r) {
      r.onstart = null;
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
      try {
        r.abort();
      } catch {}
    }
  }
}
