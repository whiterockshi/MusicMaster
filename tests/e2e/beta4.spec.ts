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
    page.getByRole("img", { name: "Lv1の日別平均得点グラフ" }),
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
    page.getByRole("heading", { name: "Lv1", exact: true }),
  ).toBeVisible();
  await expect(page.locator("section .row")).toHaveCount(12);
  await page.getByRole("button", { name: "Lv2", exact: true }).click();
  await expect(
    page.getByText("Lv2のゲームと分析はベータ5で追加予定です。"),
  ).toBeVisible();
  await expect(page.locator("section .row")).toHaveCount(0);
  await page.getByRole("button", { name: "Lv3", exact: true }).click();
  await expect(
    page.getByText("Lv3のゲームと分析はベータ5で追加予定です。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Lv1", exact: true }).click();
  await expect(page.locator("section .row")).toHaveCount(12);
  await page.screenshot({
    path: "test-results/analysis-levels.png",
    fullPage: true,
  });
});
