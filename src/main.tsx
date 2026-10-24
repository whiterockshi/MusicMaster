import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  NOTES,
  CURRENT_LAYOUT,
  questionPitches,
  midiLabel,
  type PitchLayout,
  SESSION_LENGTH,
  ANSWER_SECONDS,
  CHORD_KINDS,
  type ChordKind,
  type Level,
  type Question,
  type Attempt,
  questionKey,
  questionLabel,
  generateQuestions,
  attemptPoints,
  fullyCorrect,
  unanswered,
  hasWrongAnswer,
  analysisBuckets,
  spokenQuestion,
  FLAT_NOTES,
  RANGES,
  DEFAULT_SETTINGS,
  analysisAttempts,
  analysisResetFor,
  migrateReviews,
  type RangeMode,
  resetAnalysis,
  type Settings,
  empty,
  record,
  score,
  shuffle,
  daily,
  dayKey,
  validate,
  type Data,
  type Session,
} from "./model";
import { load, save, loadRecordings, type StorageOptions } from "./storage";
import { createSessionId } from "./id";
import {
  VoiceListener,
  voiceSupport,
  voiceErrorMessage,
  classifyAlternatives,
  parseVoice,
} from "./voice";
import {
  prepareRecording,
  type RecordingCapture,
  type RecordingResult,
} from "./recording";
import {
  unlock,
  cue,
  playQuestion,
  feedback,
  speak,
  stopAudio,
  prepareSpeech,
} from "./audio";
import "./style.css";
type Page =
  | "home"
  | "stages"
  | "review"
  | "list"
  | "history"
  | "analysis"
  | "calendar"
  | "support"
  | "settings"
  | "game"
  | "result";
type Phase =
  | "ready"
  | "announcement"
  | "waiting"
  | "playing"
  | "answer"
  | "voice-starting"
  | "feedback"
  | "correction"
  | "paused";
const labels: Record<Phase, string> = {
  ready: "準備完了",
  announcement: "問題の案内",
  waiting: "音を待ちましょう",
  playing: "よく聴いてください",
  answer: "聞こえた音を選んでください",
  "voice-starting": "マイクを準備しています",
  feedback: "回答結果",
  correction: "正解を聴き直しましょう",
  paused: "一時停止中",
};
const format = (s: string) =>
  new Date(s).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App() {
  const [data, setData] = useState<Data>(empty);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState<Page>("home");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [formNotes, setFormNotes] = useState<(number | null)[]>([null, null]);
  const [answerSlot, setAnswerSlot] = useState(0);
  const [formChord, setFormChord] = useState<ChordKind | null>(null);
  const form = useRef<{ notes: (number | null)[]; chord: ChordKind | null }>({
    notes: [null, null],
    chord: null,
  });
  const [lastAttempt, setLastAttempt] = useState<Attempt | null>(null);
  function resetForm() {
    form.current = { notes: [null, null], chord: null };
    setFormNotes([null, null]);
    setFormChord(null);
    setAnswerSlot(0);
    setLastAttempt(null);
  }
  function chooseNote(note: number) {
    const level = questions[index].level ?? 1;
    if (level === 1) {
      void submit(note);
      return;
    }
    const notes = [...form.current.notes];
    notes[level === 2 ? answerSlot : 0] = note;
    form.current = { ...form.current, notes };
    setFormNotes(notes);
    if (level === 2) setAnswerSlot(1);
  }
  function chooseChord(chord: ChordKind) {
    form.current = { ...form.current, chord };
    setFormChord(chord);
  }
  function describeQuestion(q: {
    note: number;
    level?: Level;
    range?: RangeMode;
    secondNote?: number;
    chord?: ChordKind;
    layout?: PitchLayout;
  }) {
    const range = q.range ?? "high";
    const pitches = questionPitches({ ...q, range }).map((midi) =>
      midiLabel(midi, noteNames),
    );
    if (q.level === 3)
      return `${noteNames[q.note]}${q.chord}（${pitches.join("・")}）`;
    return `${pitches.join(" → ")}（${RANGES[range].label}）`;
  }

  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [remaining, setRemaining] = useState(8);
  const [volume, setVolume] = useState(true);
  const [speechUnavailable, setSpeechUnavailable] = useState(false);
  const [date, setDate] = useState(dayKey(new Date().toISOString()));
  const [month, setMonth] = useState(date.slice(0, 7));
  const [analysisLevel, setAnalysisLevel] = useState<Level>(1);
  const [analysisRange, setAnalysisRange] = useState<RangeMode>("high");
  const [graphLevel, setGraphLevel] = useState<Level>(1);
  const [graphRange, setGraphRange] = useState<RangeMode>("high");
  const [voiceFallback, setVoiceFallback] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const [voiceHint, setVoiceHint] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceTestLevel, setVoiceTestLevel] = useState<Level>(1);
  const [voiceTesting, setVoiceTesting] = useState(false);
  const listener = useRef(new VoiceListener());
  const testListener = useRef(new VoiceListener());
  const capture = useRef<RecordingCapture | undefined>(undefined);
  const voicePrepTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const diagnostic = useRef<{
    text: string;
    error: string;
    recordingStatus?: string;
  }>({ text: "", error: "" });
  const testTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  function stopVoice() {
    clearTimeout(voicePrepTimer.current);
    listener.current.stop();
    capture.current?.cancel();
    capture.current = undefined;
  }
  function stopTest() {
    clearTimeout(testTimer.current);
    testListener.current.stop();
    setVoiceTesting(false);
  }
  const dataRef = useRef(data);
  const generation = useRef(0);
  const busy = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const started = useRef(0);
  const writes = useRef(Promise.resolve());
  const session = data.sessions.find((s) => s.id === sessionId);
  const settings = data.settings ?? DEFAULT_SETTINGS;
  const noteNames = settings.notation === "flat" ? FLAT_NOTES : NOTES;
  async function updateSettings(change: Partial<Settings>) {
    try {
      await persist({
        ...dataRef.current,
        settings: {
          ...(dataRef.current.settings ?? DEFAULT_SETTINGS),
          ...change,
        },
      });
    } catch {}
  }
  const pending = data.reviews.filter((r) => r.pending);
  const completed = data.sessions.filter(
    (s) => s.status === "complete" && s.mode === "normal",
  );
  async function persist(next: Data, options: StorageOptions = {}) {
    dataRef.current = next;
    setData(next);
    setSaving(true);
    const task = writes.current.catch(() => {}).then(() => save(next, options));
    writes.current = task;
    try {
      await task;
      setError("");
    } catch {
      setError(
        "保存に失敗しました。空き容量とブラウザ設定を確認し、JSONを保存してください。",
      );
      throw Error("保存失敗");
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    load()
      .then(async (d) => {
        for (const s of d.sessions)
          if (s.status === "active") {
            s.status = "interrupted";
            s.ended = new Date().toISOString();
          }
        await save(d);
        dataRef.current = d;
        setData(d);
        setLoaded(true);
      })
      .catch(() =>
        setError(
          "保存領域を開けません。ブラウザの保存設定を確認して再読込してください。",
        ),
      );
    return () => {
      generation.current++;
      stopVoice();
      testListener.current.stop();
      clearTimeout(testTimer.current);
      stopAudio();
    };
  }, []);
  function pause() {
    setAutoPaused(true);
    generation.current++;
    stopVoice();
    stopAudio();
    const nextPhase = phaseRef.current === "correction" ? "feedback" : "paused";
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
    busy.current = false;
  }
  useEffect(() => {
    const hide = () => {
      if (document.hidden && page === "game" && phaseRef.current !== "feedback")
        pause();
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [page]);
  useEffect(() => {
    if (phase !== "answer") return;
    const timer = setInterval(() => {
      const left = Math.max(
        0,
        ANSWER_SECONDS[questions[index].level ?? 1] -
          Math.floor((Date.now() - started.current) / 1000),
      );
      setRemaining(left);
      if (left === 0) void submit(null, null, null, true);
    }, 100);
    return () => clearInterval(timer);
  }, [phase, index, sessionId]);
  useEffect(() => {
    if (
      page !== "game" ||
      session?.inputMode !== "voice" ||
      voiceFallback ||
      autoPaused ||
      settings.voiceAutoAdvance === false ||
      document.hidden
    )
      return;
    const token = generation.current;
    if (phase === "ready") {
      const timer = setTimeout(() => {
        if (token === generation.current && !document.hidden && !busy.current)
          void play();
      }, 150);
      return () => clearTimeout(timer);
    }
    if (phase === "feedback" && lastAttempt && !saving && !busy.current) {
      const timer = setTimeout(() => {
        if (
          token === generation.current &&
          phaseRef.current === "feedback" &&
          !document.hidden &&
          !busy.current
        )
          void next();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [
    page,
    phase,
    index,
    sessionId,
    session?.inputMode,
    voiceFallback,
    autoPaused,
    settings.voiceAutoAdvance,
    lastAttempt,
    saving,
  ]);
  async function start(review = false, level: Level = 1) {
    if (busy.current) return;
    busy.current = true;
    try {
      stopAudio();
      setAutoPaused(false);
      if (volume) {
        await unlock();
        setSpeechUnavailable(!(await prepareSpeech()));
      }
      stopTest();
      setVoiceFallback(false);
      setVoiceHint("");
      setVoiceTranscript("");
      const wantsVoice =
        settings.inputMode === "voice" && settings.voiceConsentVersion === 1;
      const unsupported = wantsVoice ? voiceSupport() : undefined;
      if (unsupported) {
        setVoiceFallback(true);
        setVoiceHint(unsupported);
      }
      const now = new Date().toISOString();
      const s: Session = {
        id: createSessionId(),
        started: now,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        status: "active",
        mode: review ? "review" : "normal",
        total: review ? pending.length : SESSION_LENGTH[level],
        level,
        layout: CURRENT_LAYOUT,
        inputMode: wantsVoice && !unsupported ? "voice" : "button",
        range: level === 3 ? "bass" : settings.range,
        attempts: [],
      };
      if (!s.total) return;
      await persist({
        ...dataRef.current,
        sessions: [...dataRef.current.sessions, s],
      });
      setSessionId(s.id);
      setQuestions(
        review
          ? shuffle(
              pending.map((r) => ({
                note: r.note,
                layout: r.layout ?? 1,
                range: r.range ?? "high",
                level: r.level ?? 1,
                secondNote: r.secondNote,
                chord: r.chord,
              })),
            )
          : generateQuestions(level, settings.range),
      );
      resetForm();
      setIndex(0);
      setPhase("ready");
      setPage("game");
    } catch (e) {
      setError(e instanceof Error ? e.message : "開始できません");
    } finally {
      busy.current = false;
    }
  }
  async function play() {
    if (busy.current) return;
    setAutoPaused(false);
    busy.current = true;
    const token = ++generation.current;
    stopVoice();
    diagnostic.current = { text: "", error: "" };
    setVoiceTranscript("");
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      if (volume) await unlock();
      if (token !== generation.current) return;
      setPhase("announcement");
      if (volume) {
        cue();
        await wait(120);
        if (token !== generation.current) return;
        await speak(`第${index + 1}問`);
      }
      if (token !== generation.current) return;
      setPhase("waiting");
      if (volume) cue();
      await wait(2000);
      if (token !== generation.current) return;
      setPhase("playing");
      const duration = volume
        ? playQuestion(questions[index])
        : (questions[index].level ?? 1) === 3
          ? 4460
          : (questions[index].level ?? 1) === 2
            ? 2450
            : 1100;
      await wait(duration);
      if (token !== generation.current) return;
      if (volume) cue();
      await wait(150);
      if (token !== generation.current) return;
      if (session?.inputMode === "voice" && !voiceFallback) {
        await beginVoice(token);
      } else {
        started.current = Date.now();
        setRemaining(ANSWER_SECONDS[questions[index].level ?? 1]);
        phaseRef.current = "answer";
        setPhase("answer");
      }
    } catch {
      setError("音声を開始できません。端末の音量を確認して再開してください。");
      setPhase("paused");
    } finally {
      if (token === generation.current) busy.current = false;
    }
  }
  function failVoice(code: string, token: number) {
    if (token !== generation.current) return;
    diagnostic.current.error = code;
    setVoiceHint(
      voiceErrorMessage(code) + " このセッションはボタン回答へ切り替えます。",
    );
    setVoiceFallback(true);
    pause();
  }
  async function beginVoice(token: number) {
    phaseRef.current = "voice-starting";
    setPhase("voice-starting");
    setVoiceHint("回答開始の合図の後だけ音声を受け付けます。");
    let ready = false;
    voicePrepTimer.current = setTimeout(
      () => failVoice("start-timeout", token),
      15000,
    );
    const recordEnabled =
      settings.recordUnanswered && settings.recordingConsentVersion === 1;
    if (recordEnabled) {
      try {
        const prepared = await prepareRecording();
        if (token !== generation.current) {
          prepared.cancel();
          return;
        }
        capture.current = prepared;
      } catch (e) {
        if (token !== generation.current) return;
        diagnostic.current.recordingStatus = "unavailable";
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          failVoice("not-allowed", token);
          return;
        }
        setVoiceHint("デバッグ録音は利用できません。音声認識だけを試します。");
      }
    }
    if (token !== generation.current) return;
    busy.current = false;
    listener.current.start({
      onReady: () => {
        if (token !== generation.current || ready) return;
        ready = true;
        clearTimeout(voicePrepTimer.current);
        capture.current?.start();
        started.current = Date.now();
        setRemaining(ANSWER_SECONDS[questions[index].level ?? 1]);
        phaseRef.current = "answer";
        setPhase("answer");
        setVoiceHint("音声を受付中です。ボタンでも回答できます。");
      },
      onText: (texts) => {
        if (
          token !== generation.current ||
          phaseRef.current !== "answer" ||
          busy.current
        )
          return;
        const raw = texts.join(" / ").slice(0, 160);
        diagnostic.current.text = raw;
        setVoiceTranscript(raw);
        const result = classifyAlternatives(texts, questions[index].level ?? 1);
        if (result.status !== "valid") {
          diagnostic.current.error = result.status;
          setVoiceHint(
            result.status === "ambiguous"
              ? "候補を一つに絞れません。もう一度音名だけを話してください。"
              : "音名を判定できません。ドレミまたはコード名だけを話してください。",
          );
          return;
        }
        diagnostic.current.error = "";
        const answer = result.answer;
        const level = questions[index].level ?? 1;
        if (level === 1) {
          void submit(answer.notes[0], null, null, false, "voice", raw);
          return;
        }
        if (level === 3) {
          void submit(
            answer.notes[0],
            null,
            answer.chord!,
            false,
            "voice",
            raw,
          );
          return;
        }
        const notes =
          answer.notes.length === 2
            ? [...answer.notes]
            : [...form.current.notes];
        if (answer.notes.length === 1) {
          const slot = notes[0] === null ? 0 : 1;
          notes[slot] = answer.notes[0];
        }
        form.current = { notes, chord: null };
        setFormNotes(notes);
        setAnswerSlot(notes[0] === null ? 0 : 1);
        if (notes[0] !== null && notes[1] !== null)
          void submit(notes[0], notes[1], null, false, "voice", raw);
        else setVoiceHint("1音受け取りました。続けて2音目を話してください。");
      },
      onError: (code, fatal) => {
        if (token !== generation.current) return;
        diagnostic.current.error = code;
        if (fatal) failVoice(code, token);
        else
          setVoiceHint(
            voiceErrorMessage(code) + " 回答時間内なら再度話せます。",
          );
      },
    });
  }
  function changeInput(mode: "button" | "voice") {
    if (mode === "button") {
      stopTest();
      void updateSettings({ inputMode: "button" });
      return;
    }
    const unsupported = voiceSupport();
    if (unsupported) {
      setVoiceHint(unsupported);
      return;
    }
    if (
      settings.voiceConsentVersion !== 1 &&
      !confirm(
        "音声回答にはマイクを使います。音声はブラウザ・OS提供元（AppleやGoogle等）の認識サービスへ送信される場合があり、処理先はブラウザに依存します。認識結果の音名テキストを端末内に保存します。アプリ独自のサーバーへの送信はありません。音声回答を有効にしますか？",
      )
    )
      return;
    void updateSettings({ inputMode: "voice", voiceConsentVersion: 1 });
  }
  function changeRecording(enabled: boolean) {
    if (
      enabled &&
      settings.recordingConsentVersion !== 1 &&
      !confirm(
        "回答受付中だけ一時録音し、未回答時のみ最新2件を端末内へ保存します。1件最大10秒・1MiB、3件目で最古の音声も削除します。有効回答の音声は破棄し、自動送信しません。録音の保存を有効にしますか？",
      )
    )
      return;
    void updateSettings({
      recordUnanswered: enabled,
      ...(enabled ? { recordingConsentVersion: 1 as const } : {}),
    });
  }
  function testVoice() {
    if (voiceTesting) {
      stopTest();
      return;
    }
    if (settings.voiceConsentVersion !== 1) {
      setVoiceHint("先に音声回答を選択し、利用説明に同意してください。");
      return;
    }
    const unsupported = voiceSupport();
    if (unsupported) {
      setVoiceHint(unsupported);
      return;
    }
    setVoiceTesting(true);
    setVoiceTranscript("");
    setVoiceHint(
      "マイクの許可後、音名を話してください。このテストでは録音を保存しません。",
    );
    testTimer.current = setTimeout(() => {
      stopTest();
      setVoiceHint("テストを終了しました。必要ならもう一度試してください。");
    }, 15000);
    testListener.current.start({
      onReady: () => setVoiceHint("テスト受付中です。音名を話してください。"),
      onText: (texts) => {
        setVoiceTranscript(texts.join(" / ").slice(0, 160));
        const result = classifyAlternatives(texts, voiceTestLevel);
        setVoiceHint(
          result.status === "valid"
            ? `判定候補：${result.answer.notes.map((n) => noteNames[n]).join(" → ")}${result.answer.chord ?? ""}`
            : "候補を確定できません。発話例を確認してください。",
        );
        stopTest();
      },
      onError: (code, fatal) => {
        setVoiceHint(voiceErrorMessage(code));
        if (fatal) stopTest();
      },
    });
  }
  async function replayCorrect() {
    const token = ++generation.current;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    busy.current = true;
    phaseRef.current = "correction";
    setPhase("correction");
    try {
      await wait(600); // Let the incorrect-answer effect finish first.
      if (token !== generation.current) return;
      if (volume) {
        await unlock();
        if (token !== generation.current) return;
        await speak(
          `正解は${spokenQuestion(questions[index], settings.notation)}でした`,
        );
      }
      if (token !== generation.current) return;
      if (volume) cue();
      await wait(2000);
      if (token !== generation.current) return;
      const duration = volume
        ? playQuestion(questions[index])
        : (questions[index].level ?? 1) === 3
          ? 4460
          : (questions[index].level ?? 1) === 2
            ? 2450
            : 1100;
      await wait(duration);
    } catch {
      setError("正解音を再生できません。もう一度聴くボタンで再試行できます。");
    } finally {
      if (token === generation.current) {
        setPhase("feedback");
        phaseRef.current = "feedback";
        busy.current = false;
      }
    }
  }
  async function submit(
    value: number | null,
    second: number | null = null,
    chord: ChordKind | null = null,
    useDraft = false,
    source: "button" | "voice" = useDraft &&
    session?.inputMode === "voice" &&
    !voiceFallback
      ? "voice"
      : "button",
    recognizedText = "",
  ) {
    if (phaseRef.current !== "answer" || busy.current) return;
    busy.current = true;
    setPhase("feedback");
    phaseRef.current = "feedback";
    const q = questions[index];
    listener.current.stop();
    clearTimeout(voicePrepTimer.current);
    const recording = capture.current;
    capture.current = undefined;
    if ((q.level ?? 1) === 2 && useDraft) {
      value = form.current.notes[0];
      second = form.current.notes[1];
    }
    if (q.level === 3 && (value === null || chord === null)) {
      value = null;
      chord = null;
    }
    const a: Attempt = {
      id: `${sessionId}:${index}`,
      sessionId,
      note: q.note,
      layout: q.layout ?? 1,
      range: q.range,
      level: q.level ?? 1,
      secondNote: q.secondNote,
      secondAnswer: q.level === 2 ? second : undefined,
      chord: q.chord,
      answerChord: q.level === 3 ? chord : undefined,
      answer: value,
      at: new Date().toISOString(),
      elapsed: Date.now() - started.current,
      mode: session!.mode,
      inputMode: source,
      recognizedText:
        source === "voice"
          ? (recognizedText || diagnostic.current.text).slice(0, 160)
          : undefined,
      voiceError:
        source === "voice" ? diagnostic.current.error.slice(0, 80) : undefined,
    };
    const isUnanswered = unanswered(a);
    const recorded = recording
      ? await recording.finish(isUnanswered)
      : undefined;
    if (isUnanswered && source === "voice") {
      a.recordingStatus =
        recorded?.status ?? diagnostic.current.recordingStatus ?? "disabled";
      a.recordingBytes = recorded?.blob?.size;
      a.recordingMime = recorded?.blob?.type;
    }
    setLastAttempt(a);
    if (volume) {
      if (attemptPoints(a) === 2 && !hasWrongAnswer(a)) cue();
      else feedback(fullyCorrect(a));
    }
    try {
      await persist(record(dataRef.current, a), {
        recording:
          isUnanswered && recorded?.blob
            ? { id: a.id, blob: recorded.blob }
            : undefined,
      });
    } catch {
    } finally {
      busy.current = false;
    }
    if (
      (hasWrongAnswer(a) ||
        (a.level === 2 && (a.answer === null || a.secondAnswer === null))) &&
      phaseRef.current === "feedback"
    )
      await replayCorrect();
  }
  async function next() {
    if (busy.current) return;
    setAutoPaused(false);
    busy.current = true;
    try {
      if (index + 1 < questions.length) {
        setIndex(index + 1);
        setPhase("ready");
        resetForm();
      } else {
        const d = structuredClone(dataRef.current);
        const s = d.sessions.find((s) => s.id === sessionId)!;
        s.status = "complete";
        s.ended = new Date().toISOString();
        await persist(d);
        setPage("result");
        if (volume)
          void speak(
            `${format(s.started)}に始めた回は、${s.attempts.filter((a) => fullyCorrect(a, a.level ?? s.level)).length}問正解、${score(s)}点です。`,
          );
      }
    } catch {
    } finally {
      busy.current = false;
    }
  }
  async function end() {
    if (!confirm("ここまでの記録を残して中断しますか？")) return;
    pause();
    const d = structuredClone(dataRef.current);
    const s = d.sessions.find((s) => s.id === sessionId);
    if (s) {
      s.status = "interrupted";
      s.ended = new Date().toISOString();
      try {
        await persist(d);
      } catch {}
    }
    setPage("home");
  }
  const nav = (p: Page) => {
    stopTest();
    setPage(p);
    setMessage("");
  };
  const tile = (title: string, sub: string, p: Page) => (
    <button className="tile" onClick={() => nav(p)}>
      <span>
        {title}
        <small>{sub}</small>
      </span>
      <b aria-hidden="true">↗</b>
    </button>
  );
  const title: Record<Page, string> = {
    home: "聴くことから、はじめよう。",
    stages: "ステージを選ぶ",
    review: "聴き直す、見つける。",
    list: "間違った問題の一覧",
    history: "これまでの誤答履歴",
    analysis: "苦手分析",
    calendar: "練習の記録",
    support: "サポート",
    settings: "設定",
    game: "耳をすませて。",
    result: "おつかれさまでした。",
  };
  if (!loaded)
    return (
      <main>
        <h1>MusicSensor</h1>
        <p role="status">{error || "記録を読み込んでいます…"}</p>
      </main>
    );
  return (
    <main className={page === "game" ? "game-page" : undefined}>
      <header>
        <button
          className="brand"
          onClick={() => (page === "game" ? void end() : nav("home"))}
        >
          ◖ MusicSensor
        </button>
        <span className="badge">BETA 6</span>
      </header>
      <div className="topline">
        <span>PERSONAL EAR TRAINING</span>
        <span>
          {new Date().toLocaleDateString("ja-JP", {
            month: "long",
            day: "numeric",
          })}
        </span>
      </div>
      {page !== "home" && page !== "game" && (
        <button
          className="back"
          onClick={() =>
            nav(
              page === "stages" ||
                page === "review" ||
                page === "support" ||
                page === "result"
                ? "home"
                : page === "settings"
                  ? "support"
                  : page === "history"
                    ? "list"
                    : "review",
            )
          }
        >
          ← 戻る
        </button>
      )}
      <h1>{title[page]}</h1>
      {speechUnavailable && (
        <p className="muted" role="status">
          端末内の日本語音声が見つからないため、案内は画面表示になります。OS・ブラウザに日本語の読み上げ音声を追加してください。
        </p>
      )}
      {page === "game" &&
        voiceFallback &&
        voiceHint &&
        session?.inputMode === "button" && (
          <p className="alert" role="status">
            {voiceHint}
          </p>
        )}
      {error && (
        <p className="alert" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {page === "home" && (
        <>
          <p className="intro">
            一日、20音。
            <br />
            音の名前を見つける、小さなトレーニング。
          </p>
          <div className="hero">
            <span className="eyebrow">TODAY'S PRACTICE</span>
            <div className="hero-note" aria-hidden="true">
              ♫
            </div>
            <h2>
              ひとつの音から、
              <br />
              耳を育てる。
            </h2>
            <p>Lv1 · 単音 / 20問 / 100点満点</p>
            <button className="primary" onClick={() => nav("stages")}>
              トレーニングをはじめる <span>→</span>
            </button>
          </div>
          <div className="stats">
            <div>
              <strong>{completed.length}</strong>
              <small>完了したセッション</small>
            </div>
            <div>
              <strong>{pending.length}</strong>
              <small>復習待ちの音</small>
            </div>
            <div>
              <strong>
                {completed.length ? Math.max(...completed.map(score)) : "—"}
              </strong>
              <small>ベストスコア</small>
            </div>
          </div>
          {tile("復習", "間違った音・苦手分析・カレンダー", "review")}
          {tile("サポート", "未回答例・データのバックアップ", "support")}
          <p className="muted">
            ボタン／音声で回答できます。音声の利用設定はサポートから。記録はこのブラウザ内に保存されます。
          </p>
        </>
      )}
      {page === "stages" && (
        <>
          <p className="intro">
            回答方式：
            {settings.inputMode === "voice"
              ? "音声（ボタンも利用可能）"
              : "ボタン"}
            。変更はサポート＞設定で行えます。
          </p>
          <section>
            <span className="eyebrow">AVAILABLE</span>
            <h2>Lv1　単音</h2>
            <p>
              {RANGES[settings.range].label}（E{RANGES[settings.range].octave}
              〜Eb{RANGES[settings.range].octave + 1}
              ）の全12音が必ず出題されます（各1〜2回）。
              <br />
              聞こえた音をCDEのボタンで回答します。
            </p>
            <label>
              <input
                type="checkbox"
                checked={volume}
                onChange={(e) => setVolume(e.target.checked)}
              />{" "}
              音を再生する
            </label>
            {!volume && (
              <p className="alert">
                無音モード：画面操作の確認用です。聴音の練習には音を有効にしてください。
              </p>
            )}
            <button className="primary" onClick={() => void start()}>
              Lv1を開始する →
            </button>
          </section>
          {([2, 3] as Level[]).map((n) => (
            <section key={n}>
              <span className="badge">AVAILABLE</span>
              <h2>
                Lv{n}　{n === 2 ? "2音の聞き分け" : "コード"}
              </h2>
              <p>
                {n === 2
                  ? "異なる2音を順番に回答。10問・50点満点・回答10秒。部分点あり。"
                  : "低音ルート＋1オクターブ上げた3・5・7度。分散→同時発音。5問・25点満点。"}
              </p>
              <button className="primary" onClick={() => void start(false, n)}>
                Lv{n}を開始する →
              </button>
            </section>
          ))}
        </>
      )}
      {page === "review" && (
        <>
          {tile(
            "間違った問題の一覧",
            `${pending.length}音が復習を待っています`,
            "list",
          )}
          {tile("苦手分析", "音別の正解率と回答の傾向", "analysis")}
          {tile("カレンダー", "毎日の結果と上達のグラフ", "calendar")}
        </>
      )}
      {page === "list" && (
        <>
          <p>
            復習は待ち問題を全件ランダムに出題します。正解すると待ち一覧から消えます。
          </p>
          <button
            className="primary"
            disabled={!pending.length}
            onClick={() => void start(true)}
          >
            全{pending.length}問をまとめて復習 →
          </button>
          {!pending.length && (
            <section>復習待ちはありません。Lv1で練習しましょう。</section>
          )}
          {pending.map((r) => (
            <section className="row review-item" key={questionKey(r)}>
              <strong>{describeQuestion(r)}</strong>
              {(r.layout ?? 1) === 1 && <small>旧音域の問題</small>}
              <span>
                誤答 {r.count}回<small>最後の誤答 {format(r.last)}</small>
              </span>
            </section>
          ))}
          {tile(
            "過去の誤答履歴",
            "復習で正解した問題も記録に残ります",
            "history",
          )}
        </>
      )}
      {page === "history" && (
        <>
          {data.reviews.length === 0 && <p>まだ誤答履歴はありません。</p>}
          {data.reviews.map((r) => (
            <section key={questionKey(r)}>
              <h2>
                {describeQuestion(r)}{" "}
                <span className="badge">
                  {r.pending ? "復習待ち" : "解消済み"}
                </span>
              </h2>
              <p>
                累計 {r.count}回 / 初回 {format(r.first)}
              </p>
              {data.sessions
                .flatMap((s) =>
                  s.attempts.map((a) => ({
                    ...a,
                    layout: a.layout ?? s.layout ?? 1,
                    level: a.level ?? s.level,
                    range: a.range ?? s.range ?? "high",
                  })),
                )
                .filter(
                  (a) => questionKey(a) === questionKey(r) && hasWrongAnswer(a),
                )
                .map((a) => (
                  <p key={a.id}>
                    {format(a.at)}　回答{" "}
                    {a.answer === null ? "—" : noteNames[a.answer]}
                    {a.level === 2
                      ? ` → ${a.secondAnswer === null ? "—" : noteNames[a.secondAnswer!]}`
                      : (a.answerChord ?? "")}{" "}
                    <small>{a.mode === "review" ? "復習" : "通常"}</small>
                  </p>
                ))}
            </section>
          ))}
        </>
      )}
      {page === "analysis" && (
        <>
          <p>
            通常練習の有効回答を集計します。未回答・復習は含みません。Lv2は各音、Lv3はコードごとの集計です。5回答未満はデータ不足です。
          </p>
          <div
            className="level-filters"
            role="group"
            aria-label="分析するレベル"
          >
            {[1, 2, 3].map((level) => (
              <button
                key={level}
                aria-pressed={analysisLevel === level}
                onClick={() => {
                  setAnalysisLevel(level as Level);
                  if (level === 3) setAnalysisRange("bass");
                }}
              >
                Lv{level}
              </button>
            ))}
          </div>
          <RangeFilter
            value={analysisRange}
            onChange={setAnalysisRange}
            label="分析する音域"
          />
          <h2>
            Lv{analysisLevel} · {RANGES[analysisRange].label}
          </h2>
          <p className="muted">
            累計には旧音域の履歴も含みます。
            {analysisLevel === 3
              ? "新配置のLv3はベース側に記録します。旧配置の他音域も選んで確認できます。"
              : ""}
          </p>
          {
            <>
              <p>全期間の記録は残し、リセット後の集計だけを初期化します。</p>
              <button
                onClick={() => {
                  if (
                    confirm(
                      `本当にLv${analysisLevel}・${RANGES[analysisRange].label}のリセット後正答率をリセットしますか？ 他の音域・累計正答率・履歴・復習は残ります。`,
                    )
                  )
                    void persist(
                      resetAnalysis(
                        dataRef.current,
                        analysisLevel,
                        analysisRange,
                      ),
                    ).catch(() => {});
                }}
              >
                リセット後正答率をリセット
              </button>
              <p className="muted">
                {analysisResetFor(data, analysisLevel, analysisRange)
                  ? `最終リセット：${format(analysisResetFor(data, analysisLevel, analysisRange)!.at)}`
                  : "リセット前は累計と同じ集計です。"}
              </p>
            </>
          }
          {
            <>
              <AccuracyChart
                title="リセット後の累計正答率"
                attempts={analysisAttempts(
                  data,
                  analysisLevel,
                  true,
                  analysisRange,
                )}
                names={noteNames}
                level={analysisLevel}
              />
              <AccuracyChart
                title="累計正答率"
                attempts={analysisAttempts(
                  data,
                  analysisLevel,
                  false,
                  analysisRange,
                )}
                names={noteNames}
                level={analysisLevel}
              />
            </>
          }
          <p className="muted">
            AIによる解説は未導入です。JSON/CSVを手動で共有して分析できます。
          </p>
        </>
      )}
      {page === "calendar" && (
        <>
          <label>
            表示月{" "}
            <input
              type="month"
              value={month}
              onChange={(e) => {
                if (e.target.value) {
                  setMonth(e.target.value);
                  setDate(e.target.value + "-01");
                }
              }}
            />
          </label>
          <section>
            <h2>{month.replace("-", "年")}月</h2>
            <div className="calendar">
              {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
                <small key={d}>{d}</small>
              ))}
              {Array.from(
                { length: new Date(month + "-01T12:00:00").getDay() },
                (_, i) => (
                  <span key={"blank" + i} />
                ),
              )}
              {Array.from(
                {
                  length: new Date(
                    Number(month.slice(0, 4)),
                    Number(month.slice(5)),
                    0,
                  ).getDate(),
                },
                (_, i) => {
                  const key = month + "-" + String(i + 1).padStart(2, "0");
                  const count = data.sessions.filter(
                    (s) => s.mode === "normal" && dayKey(s.started) === key,
                  ).length;
                  return (
                    <button
                      aria-label={`${key} ${count}回`}
                      aria-pressed={date === key}
                      key={key}
                      onClick={() => setDate(key)}
                    >
                      {i + 1}
                      {count > 0 && <i />}
                    </button>
                  );
                },
              )}
            </div>
          </section>
          <h2>{date} のセッション</h2>
          <p className="muted">
            新しい順に最大5件表示（過去の記録は保存・集計に残ります）。
          </p>
          {data.sessions.filter(
            (s) => s.mode === "normal" && dayKey(s.started) === date,
          ).length === 0 && <p>この日の記録はありません。</p>}
          {data.sessions
            .filter((s) => s.mode === "normal" && dayKey(s.started) === date)
            .sort((a, b) => Date.parse(b.started) - Date.parse(a.started))
            .slice(0, 5)
            .map((s) => (
              <section className="row" key={s.id}>
                <span>
                  {format(s.started)}
                  <small>
                    Lv{s.level} · {RANGES[s.range ?? "high"].label} ·{" "}
                    {s.status === "complete" ? "完了" : "中断"} ·{" "}
                    {s.attempts.length}/{s.total}問
                  </small>
                </span>
                <strong>
                  {score(s)}
                  <small>/{s.total * 5}点</small>
                </strong>
              </section>
            ))}
          <h2>上達のグラフ</h2>
          <section>
            <div
              className="level-filters"
              role="group"
              aria-label="グラフのレベル"
            >
              {[1, 2, 3].map((level) => (
                <button
                  key={level}
                  aria-pressed={graphLevel === level}
                  onClick={() => {
                    setGraphLevel(level as Level);
                    if (level === 3) setGraphRange("bass");
                  }}
                >
                  Lv{level}
                </button>
              ))}
            </div>
            <RangeFilter
              value={graphRange}
              onChange={setGraphRange}
              label="グラフの音域"
            />
            <p>
              Lv{graphLevel} · {RANGES[graphRange].label} ·
              日別平均点（100点換算）
            </p>
            <Graph data={data} level={graphLevel} range={graphRange} />
            <p className="muted">
              各レベル・音域を個別に集計します。データがない日は0点にしません。新配置のLv3はベース側に記録します。
            </p>
          </section>
        </>
      )}
      {page === "settings" && (
        <>
          <section>
            <h2>回答方式</h2>
            <p id="voice-availability">
              {voiceSupport()
                ? `${voiceSupport()} この接続では音声回答を選べません。下の「iPhone・PCで音声回答を使うには」を確認してください。ボタン回答は利用できます。`
                : "音声回答を選択できます。利用説明に同意してから音声入力をテストしてください。"}
            </p>
            <fieldset>
              <legend>入力方法</legend>
              <label className="range-option">
                <input
                  type="radio"
                  name="input-mode"
                  checked={settings.inputMode !== "voice"}
                  disabled={saving}
                  onChange={() => changeInput("button")}
                />
                ボタン回答
              </label>
              <label className="range-option">
                <input
                  type="radio"
                  name="input-mode"
                  checked={settings.inputMode === "voice"}
                  disabled={saving || !!voiceSupport()}
                  aria-describedby="voice-availability"
                  onChange={() => changeInput("voice")}
                />
                音声回答（日本語）
              </label>
            </fieldset>
            <p>
              音声回答はマイクを使い、ブラウザ・OS提供元の認識サービスへ音声が送られる場合があります。提供元・通信要否はブラウザに依存します。アプリは外部APIキーや独自の音声サーバーを使いません。
            </p>
            <details>
              <summary>iPhone・PCで音声回答を使うには</summary>
              <p>
                PCは開発サーバーのLocalアドレスをChrome・Edge・Safariで開いてください。LAN内のHTTPアドレスでは音声回答を利用できません。
              </p>
              <p>
                iPhoneは同じWi-Fiに接続し、信頼した証明書を使うHTTPSアドレスで開きます。iPhoneでlocalhostを入力してもPCには接続できません。
              </p>
              <p>
                リポジトリの docs/IPHONE_HTTPS.md
                に、WSLでの証明書作成・iPhoneへのインストール・接続方法を記載しています。準備後はPCで
                npm run dev:https
                を実行してください。証明書の警告が出る状態では音声入力の確認へ進まず、証明書の信頼設定を確認してください。
              </p>
              <p className="muted">
                接続を変えると保存領域も変わります。履歴を移す場合はサポートでJSONバックアップを保存し、新しい接続先で復元してください。録音はJSONには含まれません。
              </p>
              <p>
                接続：{window.location.protocol === "https:" ? "HTTPS" : "HTTP"}
                {" / "}安全なコンテキスト：
                {window.isSecureContext ? "はい" : "いいえ"}
              </p>
            </details>
            <label className="range-option">
              <input
                type="checkbox"
                checked={settings.voiceAutoAdvance ?? true}
                disabled={settings.inputMode !== "voice" || saving}
                onChange={(e) =>
                  void updateSettings({ voiceAutoAdvance: e.target.checked })
                }
              />
              音声回答で出題と次問を自動進行する
            </label>
            <h3>話し方</h3>
            <p>
              Lv1：「ド」「ファシャープ」「シフラット」
              <br />
              Lv2：「ド レ」、または1音ずつ
              <br />
              Lv3：「ド メジャーセブン」「レ マイナーセブン」「ソ セブン」「シ
              マイナーセブン フラットファイブ」
            </p>
            <p className="muted">
              M7は「メジャーセブン」、m7は「マイナーセブン」と話してください。「エムセブン」だけでは区別しません。
            </p>
            <label>
              テストするレベル{" "}
              <select
                value={voiceTestLevel}
                onChange={(e) => {
                  stopTest();
                  setVoiceTestLevel(Number(e.target.value) as Level);
                }}
              >
                {[1, 2, 3].map((level) => (
                  <option key={level} value={level}>
                    Lv{level}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={settings.inputMode !== "voice" || saving}
              onClick={testVoice}
            >
              {voiceTesting ? "音声テストを停止" : "音声入力をテスト"}
            </button>
            {voiceHint && <p role="status">{voiceHint}</p>}
            {voiceTranscript && <p>認識テキスト：{voiceTranscript}</p>}
            <label className="range-option">
              <input
                type="checkbox"
                checked={settings.recordUnanswered ?? false}
                disabled={settings.inputMode !== "voice" || saving}
                onChange={(e) => changeRecording(e.target.checked)}
              />
              未回答時の音声を端末内に保存する
            </label>
            <p className="muted">
              録音は初期OFF。回答受付中だけ一時録音し、未回答の最新2件のみ保存（1件10秒・1MiBまで）。回答成立時は破棄。3件目やバッファ削除で音声も削除します。録音は自動送信せず、JSONとは別にダウンロードできます。
            </p>
          </section>
          <section>
            <h2>音名の表示</h2>
            <label className="setting-switch">
              <span>フラット表示（OFF：シャープ / ON：フラット）</span>
              <input
                type="checkbox"
                role="switch"
                aria-label="フラット表示"
                checked={settings.notation === "flat"}
                disabled={saving}
                onChange={(e) =>
                  void updateSettings({
                    notation: e.target.checked ? "flat" : "sharp",
                  })
                }
              />
            </label>
            <p>{noteNames.join(" / ")}</p>
          </section>
          <section>
            <h2>音域</h2>
            <fieldset>
              <legend>練習で鳴らす音域</legend>
              {Object.entries(RANGES).map(([key, r]) => (
                <label className="range-option" key={key}>
                  <input
                    type="radio"
                    name="range"
                    value={key}
                    checked={settings.range === key}
                    disabled={saving}
                    onChange={() =>
                      void updateSettings({ range: key as Settings["range"] })
                    }
                  />
                  {r.label}（E{r.octave}〜Eb{r.octave + 1}）
                </label>
              ))}
            </fieldset>
            <p className="muted">
              Lv1・Lv2の次回練習に適用します。Lv3は選択にかかわらずベースのルート＋上声の配置です（CM7＝C2・E3・G3・B3）。復習は誤答時の配置を保ちます。A4＝440Hz、サイン波を使います。
            </p>
          </section>
        </>
      )}
      {page === "support" && (
        <>
          {tile("設定", "回答方式・音声テスト・音名表示・音域", "settings")}
          <section>
            <h2>保存データの目安</h2>
            <p>
              {data.sessions.length}セッション · JSON換算{" "}
              {(
                new TextEncoder().encode(JSON.stringify(data)).byteLength / 1024
              ).toFixed(1)}{" "}
              KiB
            </p>
            <p className="muted">
              記録はこのブラウザのIndexedDBに保存されます。JSON換算には別保存のデバッグ音声は含みません（音声は最大2MiB）。実ディスク使用量とは異なります。履歴の自動削除は行いません。
            </p>
          </section>
          <section>
            <h2>未回答例のバッファ</h2>
            <p>{data.debug.length} / 2件 · 最新2件をFIFO保存</p>
            <p className="muted">
              音声回答と録音の同意をした場合だけ、未回答時の音声を保存します。録音はJSONバックアップに含まれません。
            </p>
            <DebugAudio debug={data.debug} />
            {data.debug.map((a) => (
              <details key={a.id}>
                <summary>
                  {format(a.at)} · {noteNames[a.note]}
                </summary>
                <pre>{JSON.stringify(a, null, 2)}</pre>
              </details>
            ))}
            <button
              disabled={!data.debug.length}
              onClick={() =>
                download(
                  "musicsensor-debug.json",
                  JSON.stringify(data.debug, null, 2),
                )
              }
            >
              未回答例をJSON保存
            </button>
            <button
              disabled={!data.debug.length}
              onClick={() => {
                if (
                  confirm(
                    "未回答のデバッグ例と保存音声を削除しますか？ セッション履歴は残ります。",
                  )
                )
                  void persist({ ...dataRef.current, debug: [] }).catch(
                    () => {},
                  );
              }}
            >
              バッファを削除
            </button>
          </section>
          <section>
            <h2>データのバックアップ</h2>
            <p>保存領域の削除や利用URLの変更に備え、JSONを保存してください。</p>
            <button
              onClick={() =>
                download(
                  "musicsensor-backup.json",
                  JSON.stringify(dataRef.current, null, 2),
                )
              }
            >
              全データをJSON保存
            </button>
            <button
              onClick={() => {
                const rows = [
                  "session_id,started,mode,status,level,score,total,answered,range,pitch_layout",
                ];
                for (const s of data.sessions)
                  rows.push(
                    [
                      s.id,
                      s.started,
                      s.mode,
                      s.status,
                      s.level,
                      score(s),
                      s.total,
                      s.attempts.length,
                      s.range ?? "high",
                      s.layout ?? 1,
                    ].join(","),
                  );
                download(
                  "musicsensor-sessions.csv",
                  "\uFEFF" + rows.join("\n"),
                  "text/csv",
                );
              }}
            >
              結果をCSV保存
            </button>
            <label className="import">
              JSONから復元（現在のデータを置換）
              <input
                type="file"
                accept="application/json,.json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    if (file.size > 10 * 1024 * 1024)
                      throw Error("JSONは10MiB以下にしてください");
                    const d = migrateReviews(
                      validate(JSON.parse(await file.text())),
                    );
                    if (
                      !confirm(
                        "現在の全データをこのJSONで置き換えます。JSONに音声は含まれないため、既存の保存音声も削除します。よろしいですか？",
                      )
                    )
                      return;
                    if (d.settings)
                      d.settings = {
                        ...d.settings,
                        inputMode: "button",
                        recordUnanswered: false,
                        voiceConsentVersion: undefined,
                        recordingConsentVersion: undefined,
                      };
                    for (const s of d.sessions)
                      if (s.status === "active") s.status = "interrupted";
                    await persist(d, { clearAudio: true });
                    setMessage(
                      "データを復元しました。音声ファイルはJSONに含まれません。音声入力と録音は、設定から改めて同意して有効にしてください。",
                    );
                  } catch (e) {
                    setMessage(
                      e instanceof Error ? e.message : "復元に失敗しました",
                    );
                  }
                }}
              />
            </label>
          </section>
        </>
      )}
      {page === "game" && session && (
        <>
          <div className="row">
            <span>
              {session.mode === "review"
                ? `復習 · Lv${questions[index].level ?? 1}`
                : `Lv${questions[index].level ?? 1}`}{" "}
              · {RANGES[questions[index].range].label}
            </span>
            <span>
              {index + 1} / {questions.length}問
            </span>
          </div>
          <progress
            max={questions.length}
            value={index + (phase === "feedback" ? 1 : 0)}
          />
          <section className={`game game-${phase}`}>
            <span className="eyebrow">
              QUESTION {String(index + 1).padStart(2, "0")}
            </span>
            <div className="sound-icon" aria-hidden="true">
              {phase === "feedback"
                ? lastAttempt && fullyCorrect(lastAttempt)
                  ? "○"
                  : lastAttempt && attemptPoints(lastAttempt) === 2
                    ? "△"
                    : lastAttempt && unanswered(lastAttempt)
                      ? "—"
                      : "×"
                : "♫"}
            </div>
            <h2 role="status">
              {phase === "answer" &&
              session.inputMode === "voice" &&
              !voiceFallback
                ? "音名を話してください"
                : labels[phase]}
            </h2>
            {phase === "ready" && (
              <>
                <p>
                  再生後、{ANSWER_SECONDS[questions[index].level ?? 1]}秒以内に
                  {questions[index].level === 2
                    ? "2音を順番に選び、判定ボタンを押してください。"
                    : questions[index].level === 3
                      ? "ルートとコードの種類を選び、判定ボタンを押してください。"
                      : "音名を選んでください。"}
                </p>
                <button className="primary" onClick={() => void play()}>
                  音を聴く →
                </button>
              </>
            )}
            {phase === "paused" && (
              <>
                <p>同じ問題をもう一度再生します。</p>
                <button className="primary" onClick={() => void play()}>
                  再開する
                </button>
              </>
            )}
            {(phase === "answer" ||
              phase === "voice-starting" ||
              phase === "paused") &&
              session.inputMode === "voice" && (
                <div className="voice-status">
                  <p role="status">{voiceHint}</p>
                  {voiceTranscript && <small>認識：{voiceTranscript}</small>}
                </div>
              )}
            {phase === "answer" && (
              <p>
                残り <strong>{remaining}</strong> 秒
              </p>
            )}
            {(phase === "feedback" || phase === "correction") && (
              <>
                <p>
                  {lastAttempt && fullyCorrect(lastAttempt)
                    ? "正解！ +5点"
                    : lastAttempt && attemptPoints(lastAttempt) === 2
                      ? "一部正解 · +2点"
                      : lastAttempt && unanswered(lastAttempt)
                        ? "未回答 · 0点（復習には追加しません）"
                        : `不正解 · 0点`}
                  {lastAttempt && !unanswered(lastAttempt) && (
                    <small>
                      回答：
                      {lastAttempt.answer === null
                        ? "—"
                        : noteNames[lastAttempt.answer]}
                      {lastAttempt.level === 2
                        ? ` → ${lastAttempt.secondAnswer === null ? "—" : noteNames[lastAttempt.secondAnswer!]}`
                        : (lastAttempt.answerChord ?? "")}
                    </small>
                  )}
                </p>
                <p>
                  正解は <strong>{describeQuestion(questions[index])}</strong>
                </p>
                {lastAttempt && !fullyCorrect(lastAttempt) && (
                  <button
                    disabled={phase === "correction" || saving}
                    onClick={() => void replayCorrect()}
                  >
                    正解をもう一度聴く
                  </button>
                )}
                <button
                  className="primary"
                  disabled={saving || phase === "correction" || busy.current}
                  onClick={() => void next()}
                >
                  {index + 1 === questions.length ? "結果を見る" : "次の問題へ"}{" "}
                  →
                </button>
              </>
            )}
          </section>
          {(questions[index].level ?? 1) === 2 && (
            <div
              className="level-filters"
              role="group"
              aria-label="回答する音の順番"
            >
              {[0, 1].map((slot) => (
                <button
                  key={slot}
                  disabled={phase !== "answer"}
                  aria-pressed={answerSlot === slot}
                  onClick={() => setAnswerSlot(slot)}
                >
                  {slot + 1}音目：
                  {formNotes[slot] === null
                    ? "未選択"
                    : noteNames[formNotes[slot]!]}
                </button>
              ))}
            </div>
          )}
          <div className="notes">
            {noteNames.map((n, i) => (
              <button
                disabled={phase !== "answer"}
                key={n}
                onClick={() => chooseNote(i)}
              >
                {n}
              </button>
            ))}
          </div>
          {questions[index].level === 3 && (
            <>
              <p>
                ルート：
                {formNotes[0] === null ? "未選択" : noteNames[formNotes[0]!]}
              </p>
              <div
                className="level-filters"
                role="group"
                aria-label="コードの種類"
              >
                {CHORD_KINDS.map((chord) => (
                  <button
                    key={chord}
                    disabled={phase !== "answer"}
                    aria-pressed={formChord === chord}
                    onClick={() => chooseChord(chord)}
                  >
                    {chord}
                  </button>
                ))}
              </div>
            </>
          )}
          {phase === "answer" && (questions[index].level ?? 1) > 1 && (
            <button
              className="primary"
              disabled={
                questions[index].level === 2
                  ? formNotes.every((n) => n === null)
                  : formNotes[0] === null || formChord === null
              }
              onClick={() =>
                void submit(
                  form.current.notes[0],
                  form.current.notes[1],
                  form.current.chord,
                )
              }
            >
              この回答で判定する
            </button>
          )}
          {phase === "answer" && (
            <button onClick={() => void submit(null)}>
              わからない（未回答）
            </button>
          )}
          {!["ready", "paused", "feedback"].includes(phase) && (
            <button onClick={pause}>一時停止</button>
          )}
          <button className="back" onClick={() => void end()}>
            中断してホームへ
          </button>
        </>
      )}
      {page === "result" && session && (
        <>
          <section className="result">
            <span className="eyebrow">
              {session.mode === "review"
                ? "REVIEW COMPLETE"
                : "SESSION COMPLETE"}
            </span>
            <p>{format(session.started)} 開始</p>
            <div className="big-score">
              {score(session)}
              <small> / {session.total * 5}</small>
            </div>
            <h2>
              {
                session.attempts.filter((a) =>
                  fullyCorrect(a, a.level ?? session.level),
                ).length
              }{" "}
              / {session.total}問正解
            </h2>
            <p>
              不正解{" "}
              {
                session.attempts.filter(
                  (a) => !unanswered(a) && attemptPoints(a) === 0,
                ).length
              }
              問 · 未回答 {session.attempts.filter((a) => unanswered(a)).length}
              問
            </p>
            <p>
              {error
                ? "保存に失敗しています。サポートからJSONを保存してください。"
                : "このブラウザに結果を保存しました。"}
            </p>
          </section>
          <p>
            一部正解（2点）：
            {session.attempts.filter((a) => attemptPoints(a) === 2).length}問
          </p>
          {tile("復習する", `${pending.length}音が復習待ち`, "list")}
          {tile("カレンダーで振り返る", "日別の結果を見る", "calendar")}
          <button className="primary" onClick={() => nav("home")}>
            ホームへ戻る
          </button>
        </>
      )}
      <footer>
        <span>MusicSensor / Beta 6</span>
        <span>{saving ? "保存中…" : "LOCAL FIRST"}</span>
      </footer>
    </main>
  );
}
function DebugAudio({ debug }: { debug: Attempt[] }) {
  const [recordings, setRecordings] = useState<
    Record<string, { blob: Blob; url: string }>
  >({});
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    setRecordings({});
    loadRecordings(debug.map((a) => a.id))
      .then((blobs) => {
        if (!active) return;
        const loaded = Object.fromEntries(
          Object.entries(blobs).map(([id, blob]) => {
            const url = URL.createObjectURL(blob);
            urls.push(url);
            return [id, { blob, url }];
          }),
        );
        setRecordings(loaded);
      })
      .catch(() => {});
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [debug]);
  return (
    <>
      {debug.map((a) => {
        const recording = recordings[a.id];
        return recording ? (
          <section key={a.id}>
            <p>
              {format(a.at)} · 音声 {(recording.blob.size / 1024).toFixed(1)}{" "}
              KiB
            </p>
            <audio controls src={recording.url} />
            <button
              onClick={() => {
                const type = recording.blob.type;
                const extension = type.includes("mp4")
                  ? "m4a"
                  : type.includes("ogg")
                    ? "ogg"
                    : "webm";
                const link = document.createElement("a");
                link.href = recording.url;
                link.download = `voice-debug-${a.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.${extension}`;
                link.click();
              }}
            >
              音声ファイルを保存
            </button>
          </section>
        ) : null;
      })}
    </>
  );
}
function AccuracyChart({
  title,
  attempts,
  names,
  level,
}: {
  title: string;
  attempts: import("./model").Attempt[];
  names: readonly string[];
  level: Level;
}) {
  const stats = analysisBuckets(attempts, level, names);
  return (
    <section className="accuracy-chart">
      <h3>{title}</h3>
      <p className="muted">
        横軸：音名 /
        縦軸：正答率（%）。横にスクロールして全候補を確認できます。—
        は回答なし、0%は回答あり・正解なし。5回答未満はデータ不足です。
      </p>
      <div
        className="chart-scroll"
        tabIndex={0}
        role="region"
        aria-label={`${title}の横スクロール領域`}
      >
        <svg
          style={{ minWidth: stats.length * 55 + 70 }}
          viewBox={`0 0 ${stats.length * 55 + 70} 270`}
          role="img"
          aria-label={`${title}の音名別正答率グラフ`}
        >
          {[0, 25, 50, 75, 100].map((rate) => (
            <g key={rate}>
              <line
                x1="40"
                x2={stats.length * 55 + 60}
                y1={220 - rate * 1.8}
                y2={220 - rate * 1.8}
                stroke="#d8ded8"
              />
              <text x="5" y={225 - rate * 1.8}>
                {rate}
              </text>
            </g>
          ))}
          {stats.map((stat, i) => (
            <g key={stat.label}>
              <rect
                x={52 + i * 55}
                y={220 - (stat.rate ?? 0) * 1.8}
                width="33"
                height={(stat.rate ?? 0) * 1.8}
                fill="#426756"
              >
                <title>
                  {stat.label}：
                  {stat.rate === null ? "—" : Math.round(stat.rate) + "%"}（
                  {stat.total}回答）
                </title>
              </rect>
              <text
                x={68 + i * 55}
                y={Math.max(25, 210 - (stat.rate ?? 0) * 1.8)}
                textAnchor="middle"
              >
                {stat.rate === null ? "—" : Math.round(stat.rate) + "%"}
              </text>
              <text x={68 + i * 55} y="242" textAnchor="middle">
                {stat.label}
              </text>
              <text x={68 + i * 55} y="262" textAnchor="middle">
                {stat.total}回答
              </text>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}
function RangeFilter({
  value,
  onChange,
  label,
}: {
  value: RangeMode;
  onChange: (range: RangeMode) => void;
  label: string;
}) {
  return (
    <div className="level-filters" role="group" aria-label={label}>
      {Object.entries(RANGES).map(([key, r]) => (
        <button
          key={key}
          aria-pressed={value === key}
          onClick={() => onChange(key as RangeMode)}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
function Graph({
  data,
  level,
  range,
}: {
  data: Data;
  level: number;
  range: RangeMode;
}) {
  const points = daily(data, level, range);
  if (!points.length)
    return <p>選択したレベル・音域の完了した通常セッションはありません。</p>;
  const min = Date.parse(points[0].day + "T12:00:00");
  const max = Date.parse(points.at(-1)!.day + "T12:00:00");
  const x = (day: string) =>
    max === min
      ? 190
      : 45 + ((Date.parse(day + "T12:00:00") - min) / (max - min)) * 295;
  return (
    <>
      <svg
        viewBox="0 0 380 220"
        role="img"
        aria-label={`Lv${level}・${RANGES[range].label}の日別平均得点グラフ`}
      >
        {[0, 25, 50, 75, 100].map((n) => (
          <g key={n}>
            <line
              x1="40"
              x2="350"
              y1={180 - n * 1.5}
              y2={180 - n * 1.5}
              stroke="#d8ded8"
            />
            <text x="5" y={185 - n * 1.5}>
              {n}
            </text>
          </g>
        ))}
        <polyline
          fill="none"
          stroke="#426756"
          strokeWidth="3"
          points={points
            .map((p) => `${x(p.day)},${180 - p.points * 1.5}`)
            .join(" ")}
        />
        {points.map((p) => (
          <circle
            key={p.day}
            cx={x(p.day)}
            cy={180 - p.points * 1.5}
            r="4"
            fill="#426756"
          >
            <title>
              {p.day}: {p.points}点
            </title>
          </circle>
        ))}
        <text x="40" y="210">
          {points[0].day.slice(5)}
        </text>
        <text x="290" y="210">
          {points.at(-1)!.day.slice(5)}
        </text>
      </svg>
      <details>
        <summary>グラフの数値を見る</summary>
        {points.map((p) => (
          <p key={p.day}>
            {p.day}：{p.points.toFixed(1)}点（{p.count}回）
          </p>
        ))}
      </details>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
