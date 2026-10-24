import { test, expect, type Page } from "@playwright/test";
const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const tones: { hz: number; at: number }[] = [];
    Object.assign(window, { beta5Tones: tones });
    const original = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (
      this: OscillatorNode,
      when?: number,
    ) {
      tones.push({ hz: this.frequency.value, at: when ?? 0 });
      return original.call(this, when);
    };
  });
}
async function tones(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { beta5Tones: { hz: number; at: number }[] })
        .beta5Tones,
  );
}
const midi = (hz: number) => Math.round(69 + 12 * Math.log2(hz / 440));
const pitch = (hz: number) => ((midi(hz) % 12) + 12) % 12;

test("Lv2 full session: two ordered answers, partial points, wrong replay and persistence", async ({
  page,
}) => {
  await instrument(page);
  await page.goto("/");
  await page.getByRole("button", { name: "トレーニングをはじめる" }).click();
  await page.getByRole("button", { name: "Lv2を開始する" }).click();
  await page.clock.install();
  for (let i = 0; i < 10; i++) {
    const before = (await tones(page)).length;
    await page.getByRole("button", { name: "音を聴く" }).click();
    await page.clock.runFor(5000);
    await expect(
      page.getByRole("button", { name: "C", exact: true }),
    ).toBeEnabled();
    const played = (await tones(page)).slice(before).filter((t) => t.hz < 1000);
    expect(played).toHaveLength(2);
    expect(played[1].at - played[0].at).toBeCloseTo(1.35, 1);
    const answers = played.map((t) => pitch(t.hz));
    expect(answers[0]).not.toBe(answers[1]);
    await page
      .getByRole("button", {
        name: names[i === 1 ? (answers[0] + 1) % 12 : answers[0]],
        exact: true,
      })
      .click();
    if (i !== 0)
      await page
        .getByRole("button", {
          name: names[i === 1 ? (answers[1] + 1) % 12 : answers[1]],
          exact: true,
        })
        .click();
    await page
      .getByRole("button", { name: "この回答で判定する", exact: true })
      .click();
    if (i === 0)
      await expect(
        page.getByText("一部正解 · +2点", { exact: false }),
      ).toBeVisible();
    if (i <= 1) {
      await expect(
        page.getByRole("status").filter({ hasText: "正解を聴き直しましょう" }),
      ).toBeVisible();
      await page.clock.runFor(6000);
    }
    if (i === 2)
      await page.screenshot({
        path: "test-results/beta5-level2.png",
        fullPage: true,
      });
    await page
      .getByRole("button", { name: i === 9 ? "結果を見る" : "次の問題へ" })
      .click();
  }
  await expect(page.locator(".big-score")).toContainText("42");
  await expect(
    page.getByRole("heading", { name: "8 / 10問正解" }),
  ).toBeVisible();
  await expect(
    page.getByText("一部正解（2点）：1問", { exact: false }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "復習", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "間違った問題の一覧" }).click();
  await expect(
    page.getByRole("button", { name: "全1問をまとめて復習" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "戻る" }).click();
  await page.getByRole("button", { name: "カレンダー", exact: false }).click();
  await page
    .getByRole("group", { name: "グラフのレベル" })
    .getByRole("button", { name: "Lv2", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Lv2・Highギターの日別平均得点グラフ" }),
  ).toBeVisible();
  await page.getByText("グラフの数値を見る").click();
  await expect(page.getByText("84.0点", { exact: false })).toBeVisible();
});

test("Lv3 full session: arpeggio then simultaneous chord, 48-class answer and range statistics", async ({
  page,
}) => {
  await instrument(page);
  await page.addInitScript(() => {
    Math.random = () => 0.999999;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "トレーニングをはじめる" }).click();
  await page.getByRole("button", { name: "Lv3を開始する" }).click();
  await page.clock.install();
  const qualities: Record<string, string> = {
    "0,16,19,23": "M7",
    "0,15,19,22": "m7",
    "0,16,19,22": "7",
    "0,15,18,22": "m7b5",
  };
  for (let i = 0; i < 5; i++) {
    const before = (await tones(page)).length;
    await page.getByRole("button", { name: "音を聴く" }).click();
    await page.clock.runFor(7000);
    await expect(
      page.getByRole("button", { name: "C", exact: true }),
    ).toBeEnabled();
    const played = (await tones(page)).slice(before).filter((t) => t.hz < 1000);
    expect(played).toHaveLength(8);
    if (i === 0) {
      const expected = [65.40639133, 164.81377846, 195.99771799, 246.94165063];
      played
        .slice(0, 4)
        .forEach((t, n) => expect(t.hz).toBeCloseTo(expected[n], 3));
    }
    const pitches = played.slice(0, 4).map((t) => midi(t.hz));
    const root = pitches[0] % 12;
    const quality = qualities[pitches.map((n) => n - pitches[0]).join(",")];
    expect(quality).toBeTruthy();
    for (let n = 0; n < 4; n++) {
      expect(played[n + 4].hz).toBeCloseTo(played[n].hz, 2);
      expect(played[n + 4].at - played[4].at).toBeLessThan(0.05);
    }
    expect(played[4].at - played[3].at).toBeGreaterThan(1.2);
    await page.getByRole("button", { name: names[root], exact: true }).click();
    await page
      .getByRole("group", { name: "コードの種類" })
      .getByRole("button", { name: quality, exact: true })
      .click();
    if (i === 0)
      await page.screenshot({
        path: "test-results/beta5-level3-answer.png",
        fullPage: true,
      });
    await page
      .getByRole("button", { name: "この回答で判定する", exact: true })
      .click();
    await expect(page.getByText("正解！ +5点", { exact: false })).toBeVisible();
    await page
      .getByRole("button", { name: i === 4 ? "結果を見る" : "次の問題へ" })
      .click();
  }
  await expect(page.locator(".big-score")).toContainText("25");
  await expect(
    page.getByRole("heading", { name: "5 / 5問正解" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "◖ MusicSensor" }).click();
  await page
    .getByRole("button", { name: "復習", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "苦手分析" }).click();
  await page
    .getByRole("group", { name: "分析するレベル" })
    .getByRole("button", { name: "Lv3", exact: true })
    .click();
  await expect(
    page.locator(".accuracy-chart").first().locator("rect"),
  ).toHaveCount(48);
  await page.screenshot({
    path: "test-results/beta5-level3-analysis.png",
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "◖ MusicSensor" }).click();
  await page.getByRole("button", { name: "サポート", exact: false }).click();
  await page
    .getByRole("button", { name: "全データをJSON保存", exact: true })
    .click();
  const path = await (await download).path();
  const { readFile } = await import("node:fs/promises");
  const backup = JSON.parse(await readFile(path!, "utf8"));
  expect(backup.sessions[0].level).toBe(3);
  expect(backup.sessions[0].range).toBe("bass");
  expect(backup.sessions[0].layout).toBe(2);
  expect(backup.sessions[0].attempts).toHaveLength(5);
  expect(
    backup.sessions[0].attempts.every(
      (a: { chord: string; answerChord: string }) => a.chord === a.answerChord,
    ),
  ).toBe(true);
});

test("mixed Lv1/Lv2/Lv3 review uses original range and removes only fully solved questions", async ({
  page,
}) => {
  await instrument(page);
  await page.goto("/");
  await page.getByRole("button", { name: "サポート", exact: false }).click();
  const questions = [
    { level: 1, note: 9, range: "bass" },
    { level: 2, note: 0, secondNote: 7, range: "low" },
    { level: 3, note: 0, chord: "m7b5", range: "high" },
  ];
  const sessions = questions.map((q, i) => ({
    id: "mixed" + i,
    started: "2026-10-24T00:00:00Z",
    timezone: "Asia/Tokyo",
    status: "interrupted",
    total: 20,
    mode: "normal",
    level: q.level,
    range: q.range,
    attempts: [
      {
        ...q,
        id: "answer" + i,
        sessionId: "mixed" + i,
        mode: "normal",
        answer: 1,
        secondAnswer: q.level === 2 ? 1 : undefined,
        answerChord: q.level === 3 ? "7" : undefined,
        at: "2026-10-24T00:01:00Z",
        elapsed: 500,
      },
    ],
  }));
  const reviews = questions.map((q) => ({
    ...q,
    first: "2026-10-24T00:01:00Z",
    last: "2026-10-24T00:01:00Z",
    count: 1,
    pending: true,
  }));
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("JSONから復元（現在のデータを置換）").setInputFiles({
    name: "mixed.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ schemaVersion: 1, sessions, reviews, debug: [] }),
    ),
  });
  await expect(page.getByRole("status")).toContainText("データを復元しました");
  await page.getByRole("button", { name: "◖ MusicSensor" }).click();
  await page
    .getByRole("button", { name: "復習", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "間違った問題の一覧" }).click();
  await expect(page.getByText("A2（ベース）", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "全3問をまとめて復習" }).click();
  await page.clock.install();
  const qualityByIntervals: Record<string, string> = {
    "0,4,7,11": "M7",
    "0,3,7,10": "m7",
    "0,4,7,10": "7",
    "0,3,6,10": "m7b5",
  };
  for (let i = 0; i < 3; i++) {
    const before = (await tones(page)).length;
    await page.getByRole("button", { name: "音を聴く" }).click();
    await page.clock.runFor(7000);
    const played = (await tones(page)).slice(before).filter((t) => t.hz < 1000);
    const notes = played.map((t) => ((pitch(t.hz) % 12) + 12) % 12);
    await page
      .getByRole("button", { name: names[notes[0]], exact: true })
      .click();
    if (played.length === 2) {
      await page
        .getByRole("button", { name: names[notes[1]], exact: true })
        .click();
      await page.getByRole("button", { name: "この回答で判定する" }).click();
    } else if (played.length === 8) {
      const raw = played.slice(0, 4).map((t) => midi(t.hz));
      const quality = qualityByIntervals[raw.map((n) => n - raw[0]).join(",")];
      await page
        .getByRole("group", { name: "コードの種類" })
        .getByRole("button", { name: quality, exact: true })
        .click();
      await page.getByRole("button", { name: "この回答で判定する" }).click();
    }
    await page
      .getByRole("button", { name: i === 2 ? "結果を見る" : "次の問題へ" })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "3 / 3問正解" }),
  ).toBeVisible();
  await expect(page.locator(".big-score")).toContainText("15");
  await page.reload();
  await page
    .getByRole("button", { name: "復習", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "間違った問題の一覧" }).click();
  await expect(
    page.getByRole("button", { name: "全0問をまとめて復習" }),
  ).toBeDisabled();
});

test("Lv2 explicit unanswered discards draft while timeout retains a valid partial answer", async ({
  page,
}) => {
  await instrument(page);
  await page.goto("/");
  await page.getByRole("button", { name: "トレーニングをはじめる" }).click();
  await page.getByRole("button", { name: "Lv2を開始する" }).click();
  await page.clock.install();
  await page.getByRole("button", { name: "音を聴く" }).click();
  await page.clock.runFor(5000);
  await page.getByRole("button", { name: "C", exact: true }).click();
  await page.getByRole("button", { name: "わからない（未回答）" }).click();
  await expect(
    page.getByText("未回答 · 0点（復習には追加しません）"),
  ).toBeVisible();
  await page.clock.runFor(6000);
  await page.getByRole("button", { name: "次の問題へ" }).click();
  const before = (await tones(page)).length;
  await page.getByRole("button", { name: "音を聴く" }).click();
  await page.clock.runFor(5000);
  const note = pitch(
    (await tones(page)).slice(before).filter((t) => t.hz < 1000)[0].hz,
  );
  await page.getByRole("button", { name: names[note], exact: true }).click();
  await page.clock.runFor(10500);
  await expect(
    page.getByText("一部正解 · +2点", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "正解を聴き直しましょう" }),
  ).toBeVisible();
  await page.clock.runFor(6000);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "中断してホームへ" }).click();
  await page
    .getByRole("button", { name: "復習", exact: false })
    .first()
    .click();
  await page.getByRole("button", { name: "間違った問題の一覧" }).click();
  await expect(
    page.getByRole("button", { name: "全0問をまとめて復習" }),
  ).toBeDisabled();
});
