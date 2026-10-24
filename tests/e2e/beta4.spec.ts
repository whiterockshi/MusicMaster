import { test, expect } from "@playwright/test";
test("20 questions, persistence, mixed review, calendar, debug FIFO and mobile layout", async ({
  page,
}) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:4173") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Math.random = () => 0;
    const frequencies: number[] = [];
    Object.assign(window, { testFrequencies: frequencies });
    const original = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (
      this: OscillatorNode,
      when?: number,
    ) {
      frequencies.push(this.frequency.value);
      return original.call(this, when);
    };
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "聴くことから、はじめよう。" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/home-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "トレーニングをはじめる" }).click();
  await expect(page.getByRole("button", { name: "準備中" })).toHaveCount(2);
  await page.getByRole("button", { name: "Lv1を開始する" }).click();
  // Exercise Web Audio in real browser once, then advance time for the whole session.
  await page.clock.install();
  const notes = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  const heard: number[] = [];
  let wrongNote = 0;
  for (let i = 0; i < 20; i++) {
    await page.getByRole("button", { name: "音を聴く" }).click();
    await page.clock.runFor(4000);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "聞こえた音を選んでください" }),
    ).toBeVisible();
    const frequency = await page.evaluate(() =>
      (window as unknown as { testFrequencies: number[] }).testFrequencies
        .filter((f) => f >= 260 && f <= 500)
        .at(-1)!,
    );
    const note = Math.round(12 * Math.log2(frequency / 440) + 9);
    heard.push(note);
    if (i === 3) wrongNote = note;
    if (i < 3)
      await page.getByRole("button", { name: "わからない（未回答）" }).click();
    else
      await page
        .getByRole("button", {
          name: notes[i === 3 ? (note + 1) % 12 : note],
          exact: true,
        })
        .click();
    if (i === 3) {
      await expect(
        page.getByRole("status").filter({ hasText: "正解を聴き直しましょう" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "次の問題へ" }),
      ).toBeDisabled();
      await page.clock.runFor(4200);
      await expect(
        page.getByRole("button", { name: "次の問題へ" }),
      ).toBeEnabled();
      const replayFrequency = await page.evaluate(() =>
        (window as unknown as { testFrequencies: number[] }).testFrequencies
          .filter((f) => f >= 260 && f <= 500)
          .at(-1)!,
      );
      expect(replayFrequency).toBeCloseTo(frequency, 3);
    }
    await page
      .getByRole("button", { name: i === 19 ? "結果を見る" : "次の問題へ" })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "16 / 20問正解" }),
  ).toBeVisible();
  await expect(page.locator(".big-score")).toContainText("80");
  expect(new Set(heard).size).toBe(12);
  for (let n = 0; n < 12; n++)
    expect(heard.filter((note) => note === n).length).toBeLessThanOrEqual(2);
  const frequencies = await page.evaluate(
    () => (window as unknown as { testFrequencies: number[] }).testFrequencies,
  );
  expect(frequencies.some((f) => Math.abs(f - 261.625565) < 0.01)).toBe(true);
  expect(frequencies).toContain(784);
  expect(frequencies).toContain(1047);
  expect(frequencies).toContain(150);
  await page.reload();
  await page
    .getByRole("button", { name: "復習", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "間違った問題の一覧" }).click();
  await expect(
    page.getByRole("button", { name: "全1問をまとめて復習" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "全1問をまとめて復習" }).click();
  await page.getByRole("button", { name: "音を聴く" }).click();
  await page.clock.runFor(4000);
  await page
    .getByRole("button", { name: notes[wrongNote], exact: true })
    .click();
  await page.getByRole("button", { name: "結果を見る" }).click();
  await expect(
    page.getByRole("heading", { name: "1 / 1問正解" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "復習する" }).click();
  await expect(
    page.getByRole("button", { name: "全0問をまとめて復習" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "過去の誤答履歴" }).click();
  await expect(page.getByText("解消済み", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "◖ MusicSensor" }).click();
  await page
    .getByRole("button", { name: "復習", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "カレンダー" }).click();
  await expect(
    page.getByRole("img", { name: "Lv1・Highギターの日別平均得点グラフ" }),
  ).toBeVisible();
  await expect(page.locator("section.row")).toHaveCount(1);
  await expect(page.locator("section.row")).toContainText("Lv1");
  const selectedDay = page.locator('.calendar button[aria-pressed="true"]');
  await expect(selectedDay).toHaveAttribute("aria-label", /1回$/);
  await page.screenshot({
    path: "test-results/calendar-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "◖ MusicSensor" }).click();
  await page.getByRole("button", { name: "サポート", exact: false }).click();
  await expect(page.getByText("2 / 2件 · 最新2件をFIFO保存")).toBeVisible();
  await page.locator("details").first().click();
  await expect(page.locator("pre").first()).toContainText(":1");
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});
test("timeout, pause, reload interruption, validation error and navigation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "トレーニングをはじめる" }).click();
  await page.getByRole("button", { name: "Lv1を開始する" }).click();
  await page.clock.install();
  await page.getByRole("button", { name: "音を聴く" }).click();
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  await page.clock.runFor(4000);
  await expect(
    page.getByRole("status").filter({ hasText: "一時停止中" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "再開する" }).click();
  await page.clock.runFor(4000);
  await expect(
    page.getByRole("button", { name: "C", exact: true }),
  ).toBeEnabled();
  await page.clock.runFor(8500);
  await expect(
    page.getByText("未回答 · 0点（復習には追加しません）"),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText("聴くことから、はじめよう。")).toBeVisible();
  await page.getByRole("button", { name: "サポート", exact: false }).click();
  await page.getByLabel("JSONから復元（現在のデータを置換）").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":42}'),
  });
  await expect(page.getByRole("status")).toContainText(
    "対応していないJSON形式",
  );
});

test("JSON backup roundtrip, cancellation, and desktop navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "サポート", exact: false }).click();
  const session = {
    id: "imported",
    started: "2026-10-24T05:00:00Z",
    ended: "2026-10-24T05:10:00Z",
    timezone: "Asia/Tokyo",
    status: "complete",
    mode: "normal",
    total: 20,
    level: 1,
    attempts: Array.from({ length: 20 }, (_, i) => ({
      id: "a" + i,
      sessionId: "imported",
      note: i % 12,
      answer: i < 15 ? i % 12 : null,
      at: "2026-10-24T05:01:00Z",
      elapsed: 500,
      mode: "normal",
    })),
  };
  const backup = {
    schemaVersion: 1,
    sessions: [session],
    reviews: [],
    debug: [],
  };
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("JSONから復元（現在のデータを置換）").setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByRole("status")).toContainText("データを復元しました");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "全データをJSON保存" }).click();
  const file = await download;
  const path = await file.path();
  const { readFile } = await import("node:fs/promises");
  expect(JSON.parse(await readFile(path!, "utf8"))).toEqual(backup);
  await page.getByRole("button", { name: "◖ MusicSensor" }).click();
  await page.screenshot({
    path: "test-results/home-desktop.png",
    fullPage: true,
  });
  await expect(page.locator(".stats")).toContainText("75");
  await page.getByRole("button", { name: "トレーニングをはじめる" }).click();
  await page.getByRole("button", { name: "Lv1を開始する" }).click();
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "中断してホームへ" }).click();
  await expect(page.getByRole("button", { name: "音を聴く" })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "中断してホームへ" }).click();
  await expect(
    page.getByRole("heading", { name: "聴くことから、はじめよう。" }),
  ).toBeVisible();
});

test("analysis is separated by level and empty levels never show Lv1 statistics", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "復習", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "苦手分析" }).click();
  await expect(
    page.getByRole("heading", { name: "Lv1 · Highギター", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".accuracy-chart svg")).toHaveCount(2);
  await page.getByRole("button", { name: "Lv2", exact: true }).click();
  await expect(
    page.getByText("Lv2のゲームと分析はベータ5で追加予定です。"),
  ).toBeVisible();
  await expect(page.locator(".accuracy-chart svg")).toHaveCount(0);
  await page.getByRole("button", { name: "Lv3", exact: true }).click();
  await expect(
    page.getByText("Lv3のゲームと分析はベータ5で追加予定です。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lv1", exact: true }).click();
  await expect(page.locator(".accuracy-chart svg")).toHaveCount(2);
  await page.screenshot({
    path: "test-results/analysis-levels.png",
    fullPage: true,
  });
});

test("flat notation and bass settings persist and change actual audio output", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const frequencies: number[] = [];
    Object.assign(window, { testFrequencies: frequencies });
    const original = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (
      this: OscillatorNode,
      when?: number,
    ) {
      frequencies.push(this.frequency.value);
      return original.call(this, when);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "サポート", exact: false }).click();
  await page.getByRole("button", { name: "設定", exact: false }).click();
  await page.getByRole("switch", { name: "フラット表示" }).check();
  await page.getByLabel("ベース（C2〜B2）").check();
  await expect(page.locator("footer")).toContainText("LOCAL FIRST");
  await page.reload();
  await page.getByRole("button", { name: "サポート", exact: false }).click();
  await page.getByRole("button", { name: "設定", exact: false }).click();
  await expect(
    page.getByRole("switch", { name: "フラット表示" }),
  ).toBeChecked();
  await expect(page.getByLabel("ベース（C2〜B2）")).toBeChecked();
  await page.screenshot({
    path: "test-results/settings-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "◖ MusicSensor" }).click();
  await page.getByRole("button", { name: "トレーニングをはじめる" }).click();
  await expect(
    page.getByText("ベース（C2〜B2）の全12音", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lv1を開始する" }).click();
  await page.clock.install();
  await page.getByRole("button", { name: "音を聴く" }).click();
  await page.clock.runFor(4000);
  await expect(
    page.getByRole("button", { name: "Db", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "C#", exact: true }),
  ).toHaveCount(0);
  const pitches = await page.evaluate(() =>
    (window as unknown as { testFrequencies: number[] }).testFrequencies.filter(
      (f) => f >= 65 && f < 124,
    ),
  );
  expect(pitches).toHaveLength(1);
});

test("analysis reset confirms, preserves all-time rates and survives reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "トレーニングをはじめる" }).click();
  await page.getByRole("button", { name: "Lv1を開始する" }).click();
  await page.clock.install();
  await page.getByRole("button", { name: "音を聴く" }).click();
  await page.clock.runFor(4000);
  await page.getByRole("button", { name: "C", exact: true }).click();
  await expect(page.locator("footer")).toContainText("LOCAL FIRST");
  await page.reload();
  await page
    .getByRole("button", { name: "復習", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "苦手分析" }).click();
  const totals = await page
    .getByRole("img", { name: "累計正答率の音名別正答率グラフ", exact: true })
    .innerHTML();
  const recent = await page
    .getByRole("img", {
      name: "リセット後の累計正答率の音名別正答率グラフ",
      exact: true,
    })
    .innerHTML();
  page.once("dialog", (d) => d.dismiss());
  await page
    .getByRole("button", { name: "リセット後正答率をリセット", exact: true })
    .click();
  expect(
    await page
      .getByRole("img", {
        name: "リセット後の累計正答率の音名別正答率グラフ",
        exact: true,
      })
      .innerHTML(),
  ).toEqual(recent);
  page.once("dialog", (d) => {
    expect(d.message()).toContain("本当に");
    return d.accept();
  });
  await page
    .getByRole("button", { name: "リセット後正答率をリセット", exact: true })
    .click();
  await expect(
    page.getByText("最終リセット：", { exact: false }),
  ).toBeVisible();
  expect(
    await page
      .getByRole("img", { name: "累計正答率の音名別正答率グラフ", exact: true })
      .innerHTML(),
  ).toEqual(totals);
  await expect(
    page
      .locator(".accuracy-chart")
      .first()
      .locator("svg text")
      .filter({ hasText: /^—$/ }),
  ).toHaveCount(12);
  await expect(page.locator("footer")).toContainText("LOCAL FIRST");
  await page.reload();
  await page
    .getByRole("button", { name: "復習", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "苦手分析" }).click();
  await expect(
    page
      .locator(".accuracy-chart")
      .first()
      .locator("svg text")
      .filter({ hasText: /^—$/ }),
  ).toHaveCount(12);
  expect(
    await page
      .getByRole("img", { name: "累計正答率の音名別正答率グラフ", exact: true })
      .innerHTML(),
  ).toEqual(totals);
  await page.screenshot({
    path: "test-results/analysis-reset.png",
    fullPage: true,
  });
});

test("legacy review migration, original-range playback, analysis and all nine graph selections", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const frequencies: number[] = [];
    Object.assign(window, { testFrequencies: frequencies });
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (
      this: OscillatorNode,
      when?: number,
    ) {
      frequencies.push(this.frequency.value);
      return start.call(this, when);
    };
  });
  const ranges = ["high", "low", "bass"];
  const sessions = ranges.map((range, i) => ({
    id: range,
    started: `2026-10-24T0${i}:00:00Z`,
    timezone: "Asia/Tokyo",
    status: "complete",
    total: 20,
    level: 1,
    mode: "normal",
    range,
    attempts: Array.from({ length: 20 }, (_, n) => ({
      id: range + n,
      sessionId: range,
      note: 9,
      answer: n < i ? 9 : 0,
      at: `2026-10-24T0${i}:01:00Z`,
      elapsed: 300,
      mode: "normal",
    })),
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "サポート", exact: false }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("JSONから復元（現在のデータを置換）").setInputFiles({
    name: "legacy.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        sessions,
        debug: [],
        reviews: [
          {
            note: 9,
            first: "2026-10-24T00:01:00Z",
            last: "2026-10-24T02:01:00Z",
            count: 57,
            pending: true,
          },
        ],
      }),
    ),
  });
  await expect(page.getByRole("status")).toContainText("データを復元しました");
  await page.getByRole("button", { name: "◖ MusicSensor" }).click();
  await page
    .getByRole("button", { name: "復習", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "間違った問題の一覧" }).click();
  for (const label of ["A4（Highギター）", "A3（Lowギター）", "A2（ベース）"])
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/review-ranges.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "全3問をまとめて復習" }).click();
  await page.clock.install();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "音を聴く" }).click();
    await page.clock.runFor(4000);
    await page.getByRole("button", { name: "A", exact: true }).click();
    await page
      .getByRole("button", { name: i === 2 ? "結果を見る" : "次の問題へ" })
      .click();
  }
  const frequencies = await page.evaluate(
    () => (window as unknown as { testFrequencies: number[] }).testFrequencies,
  );
  for (const hz of [110, 220, 440]) expect(frequencies).toContain(hz);
  await page.getByRole("button", { name: "◖ MusicSensor" }).click();
  await page
    .getByRole("button", { name: "復習", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "苦手分析" }).click();
  await expect(page.locator(".bar")).toHaveCount(0);
  await page
    .getByRole("group", { name: "分析する音域" })
    .getByRole("button", { name: "ベース", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Lv1 · ベース" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".accuracy-chart")
      .first()
      .locator("title")
      .filter({ hasText: "A：10%" }),
  ).toContainText("10%");
  await page.screenshot({
    path: "test-results/analysis-range.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "戻る" }).click();
  await page.getByRole("button", { name: "カレンダー" }).click();
  for (const level of [1, 2, 3]) {
    await page
      .getByRole("group", { name: "グラフのレベル" })
      .getByRole("button", { name: `Lv${level}`, exact: true })
      .click();
    for (const label of ["Highギター", "Lowギター", "ベース"]) {
      await page
        .getByRole("group", { name: "グラフの音域" })
        .getByRole("button", { name: label, exact: true })
        .click();
      if (level === 1)
        await expect(
          page.getByRole("img", { name: `Lv1・${label}の日別平均得点グラフ` }),
        ).toBeVisible();
      else
        await expect(
          page.getByText(
            "選択したレベル・音域の完了した通常セッションはありません。",
          ),
        ).toBeVisible();
    }
  }
});

test("calendar shows only latest five sessions but retains all stored sessions", async ({
  page,
}) => {
  const sessions = Array.from({ length: 7 }, (_, i) => ({
    id: "calendar" + i,
    started: `2026-10-24T0${i}:00:00Z`,
    timezone: "Asia/Tokyo",
    status: "interrupted",
    total: 20,
    level: 1,
    mode: "normal",
    attempts: [],
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "サポート", exact: false }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("JSONから復元（現在のデータを置換）").setInputFiles({
    name: "sessions.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ schemaVersion: 1, sessions, reviews: [], debug: [] }),
    ),
  });
  await expect(page.getByRole("status")).toContainText("データを復元しました");
  await expect(
    page.getByText("7セッション · JSON換算", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "◖ MusicSensor" }).click();
  await page
    .getByRole("button", { name: "復習", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "カレンダー", exact: false }).click();
  await page
    .getByRole("button", { name: "2026-10-24 7回", exact: true })
    .click();
  await expect(page.locator("section.row")).toHaveCount(5);
  const rows = await page.locator("section.row").allTextContents();
  const expected = sessions
    .slice(2)
    .reverse()
    .map((s) =>
      new Date(s.started).toLocaleString("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  rows.forEach((row, i) => expect(row).toContain(expected[i]));
  await page.getByRole("button", { name: "◖ MusicSensor" }).click();
  await page.getByRole("button", { name: "サポート", exact: false }).click();
  await expect(
    page.getByText("7セッション · JSON換算", { exact: false }),
  ).toBeVisible();
});
