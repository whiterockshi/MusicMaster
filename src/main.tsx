import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  NOTES,
  FLAT_NOTES,
  RANGES,
  DEFAULT_SETTINGS,
  analysisAttempts,
  analysisResetFor,
  spokenNote,
  migrateReviews,
  type RangeMode,
  resetAnalysis,
  type Settings,
  empty,
  record,
  score,
  shuffle,
  levelOneQuestions,
  daily,
  dayKey,
  validate,
  type Data,
  type Session,
} from "./model";
import { load, save } from "./storage";
import { unlock, cue, playNote, feedback, speak, stopAudio } from "./audio";
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
  | "feedback"
  | "correction"
  | "paused";
const labels: Record<Phase, string> = {
  ready: "準備完了",
  announcement: "問題の案内",
  waiting: "音を待ちましょう",
  playing: "よく聴いてください",
  answer: "聞こえた音を選んでください",
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
  const [questions, setQuestions] = useState<
    { note: number; range: RangeMode }[]
  >([]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [remaining, setRemaining] = useState(8);
  const [answer, setAnswer] = useState<number | null>(null);
  const [volume, setVolume] = useState(true);
  const [date, setDate] = useState(dayKey(new Date().toISOString()));
  const [month, setMonth] = useState(date.slice(0, 7));
  const [analysisLevel, setAnalysisLevel] = useState(1);
  const [analysisRange, setAnalysisRange] = useState<RangeMode>("high");
  const [graphLevel, setGraphLevel] = useState(1);
  const [graphRange, setGraphRange] = useState<RangeMode>("high");
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
  async function persist(next: Data) {
    dataRef.current = next;
    setData(next);
    setSaving(true);
    const task = writes.current.catch(() => {}).then(() => save(next));
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
      stopAudio();
    };
  }, []);
  function pause() {
    generation.current++;
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
        8 - Math.floor((Date.now() - started.current) / 1000),
      );
      setRemaining(left);
      if (left === 0) void submit(null);
    }, 100);
    return () => clearInterval(timer);
  }, [phase, index, sessionId]);
  async function start(review = false) {
    if (busy.current) return;
    busy.current = true;
    try {
      if (volume) await unlock();
      const now = new Date().toISOString();
      const s: Session = {
        id: crypto.randomUUID(),
        started: now,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        status: "active",
        mode: review ? "review" : "normal",
        total: review ? pending.length : 20,
        level: 1,
        range: settings.range,
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
              pending.map((r) => ({ note: r.note, range: r.range ?? "high" })),
            )
          : levelOneQuestions().map((note) => ({
              note,
              range: settings.range,
            })),
      );
      setIndex(0);
      setPhase("ready");
      setPage("game");
      setAnswer(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "開始できません");
    } finally {
      busy.current = false;
    }
  }
  async function play() {
    if (busy.current) return;
    busy.current = true;
    const token = ++generation.current;
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
      if (volume) playNote(questions[index].note, questions[index].range);
      await wait(1100);
      if (token !== generation.current) return;
      if (volume) cue();
      await wait(150);
      if (token !== generation.current) return;
      started.current = Date.now();
      setRemaining(8);
      setPhase("answer");
    } catch {
      setError("音声を開始できません。端末の音量を確認して再開してください。");
      setPhase("paused");
    } finally {
      if (token === generation.current) busy.current = false;
    }
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
          `正解は${spokenNote(questions[index].note, settings.notation)}でした`,
        );
      }
      if (token !== generation.current) return;
      if (volume) cue();
      await wait(2000);
      if (token !== generation.current) return;
      if (volume) playNote(questions[index].note, questions[index].range);
      await wait(1100);
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
  async function submit(value: number | null) {
    if (phaseRef.current !== "answer" || busy.current) return;
    busy.current = true;
    setPhase("feedback");
    phaseRef.current = "feedback";
    setAnswer(value);
    if (volume) feedback(value === questions[index].note);
    const a = {
      id: `${sessionId}:${index}`,
      sessionId,
      note: questions[index].note,
      range: questions[index].range,
      answer: value,
      at: new Date().toISOString(),
      elapsed: Date.now() - started.current,
      mode: session!.mode,
    };
    try {
      await persist(record(dataRef.current, a));
    } catch {
    } finally {
      busy.current = false;
    }
    if (
      value !== null &&
      value !== questions[index].note &&
      phaseRef.current === "feedback"
    )
      await replayCorrect();
  }
  async function next() {
    if (busy.current) return;
    busy.current = true;
    try {
      if (index + 1 < questions.length) {
        setIndex(index + 1);
        setPhase("ready");
        setAnswer(null);
      } else {
        const d = structuredClone(dataRef.current);
        const s = d.sessions.find((s) => s.id === sessionId)!;
        s.status = "complete";
        s.ended = new Date().toISOString();
        await persist(d);
        setPage("result");
        if (volume)
          void speak(
            `${format(s.started)}に始めた回は、${s.attempts.filter((a) => a.answer === a.note).length}問正解、${score(s)}点です。`,
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
    <main>
      <header>
        <button
          className="brand"
          onClick={() => (page === "game" ? void end() : nav("home"))}
        >
          ◖ MusicSensor
        </button>
        <span className="badge">BETA 4</span>
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
            ボタンで回答するローカル版です。記録はこのブラウザ内に保存されます。
          </p>
        </>
      )}
      {page === "stages" && (
        <>
          <p className="intro">まずは12音の聞き分けから。</p>
          <section>
            <span className="eyebrow">AVAILABLE</span>
            <h2>Lv1　単音</h2>
            <p>
              {RANGES[settings.range].label}（C{RANGES[settings.range].octave}
              〜B{RANGES[settings.range].octave}
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
          {[2, 3].map((n) => (
            <section className="disabled" key={n}>
              <span className="badge">ベータ5で追加予定</span>
              <h2>
                Lv{n}　{n === 2 ? "2音の聞き分け" : "コード"}
              </h2>
              <p>
                {n === 2
                  ? "順番に鳴る2音を回答。部分点あり。"
                  : "分散和音と同時和音を聞いて回答。"}
              </p>
              <button disabled>準備中</button>
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
            <section
              className="row review-item"
              key={`${r.range ?? "high"}:${r.note}`}
            >
              <strong>
                {noteNames[r.note]}
                {RANGES[r.range ?? "high"].octave}（
                {RANGES[r.range ?? "high"].label}）
              </strong>
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
            <section key={`${r.range ?? "high"}:${r.note}`}>
              <h2>
                {noteNames[r.note]}
                {RANGES[r.range ?? "high"].octave}（
                {RANGES[r.range ?? "high"].label}）{" "}
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
                    range: a.range ?? s.range ?? "high",
                  })),
                )
                .filter(
                  (a) =>
                    a.note === r.note &&
                    a.range === (r.range ?? "high") &&
                    a.answer !== null &&
                    a.answer !== a.note,
                )
                .map((a) => (
                  <p key={a.id}>
                    {format(a.at)}　回答 {noteNames[a.answer!]}{" "}
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
            通常練習の有効回答を集計します。未回答・復習は含みません。5回未満の音はデータ不足です。
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
                onClick={() => setAnalysisLevel(level)}
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
          {analysisLevel !== 1 && (
            <section>
              Lv{analysisLevel}のゲームと分析はベータ5で追加予定です。
            </section>
          )}
          {analysisLevel === 1 && (
            <>
              <p>全期間の記録は残し、リセット後の集計だけを初期化します。</p>
              <button
                onClick={() => {
                  if (
                    confirm(
                      `本当にLv1・${RANGES[analysisRange].label}のリセット後正答率をリセットしますか？ 他の音域・累計正答率・履歴・復習は残ります。`,
                    )
                  )
                    void persist(
                      resetAnalysis(dataRef.current, 1, analysisRange),
                    ).catch(() => {});
                }}
              >
                リセット後正答率をリセット
              </button>
              <p className="muted">
                {analysisResetFor(data, 1, analysisRange)
                  ? `最終リセット：${format(analysisResetFor(data, 1, analysisRange)!.at)}`
                  : "リセット前は累計と同じ集計です。"}
              </p>
            </>
          )}
          {analysisLevel === 1 && (
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
              />
            </>
          )}
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
                  onClick={() => setGraphLevel(level)}
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
              Lv{graphLevel} · {RANGES[graphRange].label} · 日別平均点
            </p>
            <Graph data={data} level={graphLevel} range={graphRange} />
            <p className="muted">
              Lv2・Lv3はベータ5で追加。データがない日は0点にしません。
            </p>
          </section>
        </>
      )}
      {page === "settings" && (
        <>
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
                  {r.label}（C{r.octave}〜B{r.octave}）
                </label>
              ))}
            </fieldset>
            <p className="muted">
              次に開始する通常練習に適用します。復習は誤答時の音域で鳴らします。音色は共通のサイン波です。
            </p>
          </section>
        </>
      )}
      {page === "support" && (
        <>
          {tile("設定", "シャープ・フラット表示 / 音域", "settings")}
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
              記録はこのブラウザのIndexedDBに保存されます。録音はありません。JSON換算はデータ量の目安で、実際のディスク使用量とは異なります。履歴の自動削除は行いません。
            </p>
          </section>
          <section>
            <h2>未回答例のバッファ</h2>
            <p>{data.debug.length} / 2件 · 最新2件をFIFO保存</p>
            <p className="muted">この版ではマイク・録音を利用しません。</p>
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
                if (confirm("未回答例だけを削除しますか？"))
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
                  "session_id,started,mode,status,level,score,total,answered,range",
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
                        "現在の全データをこのJSONで置き換えます。よろしいですか？",
                      )
                    )
                      return;
                    for (const s of d.sessions)
                      if (s.status === "active") s.status = "interrupted";
                    await persist(d);
                    setMessage("データを復元しました。");
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
              {session.mode === "review" ? "復習" : "Lv1 · 単音"} ·{" "}
              {RANGES[questions[index].range].label}
            </span>
            <span>
              {index + 1} / {questions.length}問
            </span>
          </div>
          <progress
            max={questions.length}
            value={index + (phase === "feedback" ? 1 : 0)}
          />
          <section className="game">
            <span className="eyebrow">
              QUESTION {String(index + 1).padStart(2, "0")}
            </span>
            <div className="sound-icon" aria-hidden="true">
              {phase === "feedback"
                ? answer === questions[index].note
                  ? "○"
                  : answer === null
                    ? "—"
                    : "×"
                : "♫"}
            </div>
            <h2 role="status">{labels[phase]}</h2>
            {phase === "ready" && (
              <>
                <p>再生後、8秒以内に音名を選んでください。</p>
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
            {phase === "answer" && (
              <p>
                残り <strong>{remaining}</strong> 秒
              </p>
            )}
            {(phase === "feedback" || phase === "correction") && (
              <>
                <p>
                  {answer === questions[index].note
                    ? "正解！ +5点"
                    : answer === null
                      ? "未回答 · 0点（復習には追加しません）"
                      : `不正解 · 回答 ${noteNames[answer]}`}
                </p>
                <p>
                  正解は <strong>{noteNames[questions[index].note]}</strong>
                </p>
                {answer !== null && answer !== questions[index].note && (
                  <button
                    disabled={phase === "correction" || saving}
                    onClick={() => void replayCorrect()}
                  >
                    正解をもう一度聴く
                  </button>
                )}
                <button
                  className="primary"
                  disabled={saving || phase === "correction"}
                  onClick={() => void next()}
                >
                  {index + 1 === questions.length ? "結果を見る" : "次の問題へ"}{" "}
                  →
                </button>
              </>
            )}
          </section>
          <div className="notes">
            {noteNames.map((n, i) => (
              <button
                disabled={phase !== "answer"}
                key={n}
                onClick={() => void submit(i)}
              >
                {n}
              </button>
            ))}
          </div>
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
              {session.attempts.filter((a) => a.answer === a.note).length} /{" "}
              {session.total}問正解
            </h2>
            <p>
              不正解{" "}
              {
                session.attempts.filter(
                  (a) => a.answer !== null && a.answer !== a.note,
                ).length
              }
              問 · 未回答{" "}
              {session.attempts.filter((a) => a.answer === null).length}問
            </p>
            <p>
              {error
                ? "保存に失敗しています。サポートからJSONを保存してください。"
                : "このブラウザに結果を保存しました。"}
            </p>
          </section>
          {tile("復習する", `${pending.length}音が復習待ち`, "list")}
          {tile("カレンダーで振り返る", "日別の結果を見る", "calendar")}
          <button className="primary" onClick={() => nav("home")}>
            ホームへ戻る
          </button>
        </>
      )}
      <footer>
        <span>MusicSensor / Beta 4</span>
        <span>{saving ? "保存中…" : "LOCAL FIRST"}</span>
      </footer>
    </main>
  );
}
function AccuracyChart({
  title,
  attempts,
  names,
}: {
  title: string;
  attempts: import("./model").Attempt[];
  names: readonly string[];
}) {
  const stats = names.map((note, n) => {
    const answers = attempts.filter((a) => a.note === n);
    const correct = answers.filter((a) => a.answer === n).length;
    return {
      note,
      total: answers.length,
      rate: answers.length ? (correct / answers.length) * 100 : null,
    };
  });
  return (
    <section className="accuracy-chart">
      <h3>{title}</h3>
      <p className="muted">
        横軸：音名 /
        縦軸：正答率（%）。横にスクロールして全12音を確認できます。—
        は回答なし、0%は回答あり・正解なし。5回答未満はデータ不足です。
      </p>
      <div
        className="chart-scroll"
        tabIndex={0}
        role="region"
        aria-label={`${title}の横スクロール領域`}
      >
        <svg
          viewBox="0 0 720 270"
          role="img"
          aria-label={`${title}の音名別正答率グラフ`}
        >
          {[0, 25, 50, 75, 100].map((rate) => (
            <g key={rate}>
              <line
                x1="40"
                x2="710"
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
            <g key={stat.note}>
              <rect
                x={52 + i * 55}
                y={220 - (stat.rate ?? 0) * 1.8}
                width="33"
                height={(stat.rate ?? 0) * 1.8}
                fill="#426756"
              >
                <title>
                  {stat.note}：
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
                {stat.note}
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
