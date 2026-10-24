import { test, expect, type Page } from "@playwright/test";
async function mockVoice(page: Page) {
  await page.addInitScript(() => {
    Math.random = () => 0.999999;
    const events: { type: string; at: number }[] = [];
    const instances: Recognition[] = [];
    class Recognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 5;
      onstart: ((e: Event) => void) | null = null;
      onend: ((e: Event) => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      results: unknown[] = [];
      start() {
        instances.push(this);
        events.push({ type: "recognition-start", at: Date.now() });
        setTimeout(() => this.onstart?.(new Event("start")), 20);
      }
      abort() {
        events.push({ type: "recognition-abort", at: Date.now() });
      }
    }
    class Recorder {
      static isTypeSupported() {
        return true;
      }
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable?: (e: { data: Blob }) => void;
      onstop?: () => void;
      onerror?: () => void;
      timer?: ReturnType<typeof setInterval>;
      start() {
        this.state = "recording";
        events.push({ type: "recorder-start", at: Date.now() });
        this.timer = setInterval(
          () =>
            this.ondataavailable?.({
              data: new Blob(["fake voice sample"], { type: this.mimeType }),
            }),
          200,
        );
      }
      stop() {
        this.state = "inactive";
        clearInterval(this.timer);
        events.push({ type: "recorder-stop", at: Date.now() });
        queueMicrotask(() => {
          this.ondataavailable?.({
            data: new Blob(["end"], { type: this.mimeType }),
          });
          this.onstop?.();
        });
      }
    }
    Object.assign(window, {
      SpeechRecognition: Recognition,
      MediaRecorder: Recorder,
      __voiceEvents: events,
      __voiceInstances: instances,
      __emitVoice: (texts: string[]) => {
        const r = instances.at(-1);
        if (!r) return;
        const result = Object.assign(
          texts.map((transcript) => ({ transcript })),
          { isFinal: true },
        );
        r.results.push(result);
        r.onresult?.({ resultIndex: r.results.length - 1, results: r.results });
      },
      __voiceError: (error: string) => instances.at(-1)?.onerror?.({ error }),
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          events.push({ type: "get-user-media", at: Date.now() });
          return {
            getTracks: () => [
              {
                stop: () => events.push({ type: "track-stop", at: Date.now() }),
              },
            ],
          };
        },
      },
    });
  });
}
async function emit(page: Page, texts: string[]) {
  await page.evaluate(
    (texts) =>
      (
        window as unknown as { __emitVoice: (texts: string[]) => void }
      ).__emitVoice(texts),
    texts,
  );
}
async function events(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __voiceEvents: { type: string; at: number }[] })
        .__voiceEvents,
  );
}
async function enableVoice(page: Page, record = false, auto = false) {
  await page.goto("/");
  await page.getByRole("button", { name: "サポート", exact: false }).click();
  await page.getByRole("button", { name: "設定", exact: false }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("音声回答（日本語）", { exact: true }).check();
  await expect(page.locator("footer")).toContainText("LOCAL FIRST");
  if (!auto) {
    await page
      .getByLabel("音声回答で出題と次問を自動進行する", { exact: true })
      .uncheck();
    await expect(page.locator("footer")).toContainText("LOCAL FIRST");
  }
  if (record) {
    page.once("dialog", (d) => d.accept());
    await page
      .getByLabel("未回答時の音声を端末内に保存する", { exact: true })
      .check();
    await expect(page.locator("footer")).toContainText("LOCAL FIRST");
  }
  await page.getByRole("button", { name: "◖ MusicSensor" }).click();
  await page.getByRole("button", { name: "トレーニングをはじめる" }).click();
}
async function start(page: Page, level = 1) {
  await page.getByRole("button", { name: `Lv${level}を開始する` }).click();
  await page.clock.install();
}
async function listen(page: Page, level = 1) {
  await page.getByRole("button", { name: "音を聴く" }).click();
  await page.clock.runFor(level === 3 ? 7000 : level === 2 ? 5000 : 4000);
  await expect(
    page.getByRole("status").filter({ hasText: "音名を話してください" }),
  ).toBeVisible();
}
async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("musicsensor", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(["state", "debugAudio"], "readonly");
    const read = (store: string, key?: string) =>
      new Promise<unknown>((resolve, reject) => {
        const r = key
          ? tx.objectStore(store).get(key)
          : tx.objectStore(store).getAllKeys();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const [state, audioKeys] = await Promise.all([
      read("state", "main"),
      read("debugAudio"),
    ]);
    db.close();
    return { state, audioKeys };
  });
}

test("consent cancellation never starts a microphone and button mode remains usable", async ({
  page,
}) => {
  await mockVoice(page);
  await page.goto("/");
  await page.getByRole("button", { name: "サポート", exact: false }).click();
  await page.getByRole("button", { name: "設定", exact: false }).click();
  page.once("dialog", (d) => d.dismiss());
  await page.getByLabel("音声回答（日本語）").click();
  await expect(page.getByLabel("ボタン回答", { exact: true })).toBeChecked();
  expect(await events(page)).toEqual([]);
});

test("Lv1 voice classifies enharmonics, rejects ambiguity and ignores late callbacks", async ({
  page,
}) => {
  await mockVoice(page);
  await enableVoice(page);
  expect(await events(page)).toEqual([]);
  await start(page);
  await page.getByRole("button", { name: "音を聴く" }).click();
  await page.clock.runFor(2500);
  expect(
    (await events(page)).filter((e) => e.type === "recognition-start"),
  ).toHaveLength(0);
  await page.clock.runFor(1500);
  await emit(page, ["風の音"]);
  await expect(
    page.getByText("音名を判定できません。", { exact: false }),
  ).toBeVisible();
  await emit(page, ["ド", "レ"]);
  await expect(
    page.getByText("候補を一つに絞れません。", { exact: false }),
  ).toBeVisible();
  await emit(page, ["ド"]);
  await expect(page.getByText("正解！ +5点", { exact: false })).toBeVisible();
  await emit(page, ["レ"]);
  await page.getByRole("button", { name: "次の問題へ" }).click();
  await listen(page);
  await emit(page, ["レフラット", "ドシャープ"]);
  await expect(page.getByText("正解！ +5点", { exact: false })).toBeVisible();
  await expect(page.locator("footer")).toContainText("LOCAL FIRST");
  const snapshot = await stored(page);
  const data = snapshot.state as {
    sessions: { attempts: { inputMode: string }[] }[];
  };
  expect(data.sessions[0].attempts).toHaveLength(2);
  expect(data.sessions[0].attempts.every((a) => a.inputMode === "voice")).toBe(
    true,
  );
  expect(
    (await events(page)).filter((e) => e.type === "get-user-media"),
  ).toHaveLength(0);
  await page.screenshot({
    path: "test-results/beta6-voice-result.png",
    fullPage: true,
  });
});

test("permission rejection pauses without scoring and allows button restart", async ({
  page,
}) => {
  await mockVoice(page);
  await enableVoice(page);
  await start(page);
  await listen(page);
  await page.evaluate(() =>
    (
      window as unknown as { __voiceError: (error: string) => void }
    ).__voiceError("not-allowed"),
  );
  await expect(
    page.getByRole("status").filter({ hasText: "一時停止中" }),
  ).toBeVisible();
  await expect(
    page.getByText("このセッションはボタン回答へ切り替えます。", {
      exact: false,
    }),
  ).toBeVisible();
  const before = (await events(page)).filter(
    (e) => e.type === "recognition-start",
  ).length;
  await page.getByRole("button", { name: "再開する" }).click();
  await page.clock.runFor(4000);
  await page.getByRole("button", { name: "C", exact: true }).click();
  await expect(page.getByText("正解！ +5点", { exact: false })).toBeVisible();
  await expect(page.locator("footer")).toContainText("LOCAL FIRST");
  const snapshot = await stored(page);
  expect(
    (snapshot.state as { sessions: { attempts: unknown[] }[] }).sessions[0]
      .attempts,
  ).toHaveLength(1);
  expect(
    (await events(page)).filter((e) => e.type === "recognition-start"),
  ).toHaveLength(before);
});

test("Lv2 accepts two separate utterances and does not confuse partials with duplicate answers", async ({
  page,
}) => {
  await mockVoice(page);
  await enableVoice(page);
  await start(page, 2);
  await listen(page, 2);
  await emit(page, ["ド"]);
  await expect(
    page.getByText("1音受け取りました。", { exact: false }),
  ).toBeVisible();
  await emit(page, ["レフラット"]);
  await expect(page.getByText("正解！ +5点", { exact: false })).toBeVisible();
  await expect(page.locator("footer")).toContainText("LOCAL FIRST");
  const data = (await stored(page)).state as {
    sessions: { attempts: { answer: number; secondAnswer: number }[] }[];
  };
  expect(data.sessions[0].attempts[0].answer).toBe(0);
  expect(data.sessions[0].attempts[0].secondAnswer).toBe(1);
});

test("Lv3 uses root and explicit chord quality rather than the expected answer", async ({
  page,
}) => {
  await mockVoice(page);
  await enableVoice(page);
  await start(page, 3);
  await listen(page, 3);
  await emit(page, ["ド マイナーセブン"]);
  await expect(page.getByText("不正解 · 0点", { exact: false })).toBeVisible();
  await page.clock.runFor(8000);
  await expect(page.locator("footer")).toContainText("LOCAL FIRST");
  const data = (await stored(page)).state as {
    sessions: { attempts: { chord: string; answerChord: string }[] }[];
    reviews: unknown[];
  };
  expect(data.sessions[0].attempts[0].chord).toBe("M7");
  expect(data.sessions[0].attempts[0].answerChord).toBe("m7");
  expect(data.reviews).toHaveLength(1);
});

test("optional audio stays within the two-item FIFO and is evicted and deleted with diagnostics", async ({
  page,
}) => {
  await mockVoice(page);
  await enableVoice(page, true);
  await start(page);
  for (let i = 0; i < 3; i++) {
    await listen(page);
    await emit(page, ["風の音"]);
    await page.clock.runFor(8500);
    await expect(
      page.getByText("未回答 · 0点（復習には追加しません）"),
    ).toBeVisible();
    await page.getByRole("button", { name: "次の問題へ" }).click();
  }
  let snapshot = await stored(page);
  let state = snapshot.state as {
    debug: { id: string; recordingBytes: number }[];
    sessions: { attempts: { recognizedText?: string }[] }[];
  };
  expect(state.debug).toHaveLength(2);
  expect(snapshot.audioKeys).toEqual(state.debug.map((a) => a.id));
  expect(
    state.debug.every(
      (a) => a.recordingBytes > 0 && a.recordingBytes <= 1048576,
    ),
  ).toBe(true);
  expect(
    state.sessions[0].attempts.every((a) => a.recognizedText === undefined),
  ).toBe(true);
  await listen(page);
  await emit(page, ["レシャープ"]);
  await expect(page.getByText("正解！ +5点", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "次の問題へ" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "中断してホームへ" }).click();
  await page.getByRole("button", { name: "サポート", exact: false }).click();
  await expect(page.locator("audio")).toHaveCount(2);
  await page.screenshot({
    path: "test-results/beta6-recordings-present.png",
    fullPage: true,
  });
  await page.reload();
  await page.getByRole("button", { name: "サポート", exact: false }).click();
  await expect(page.locator("audio")).toHaveCount(2);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "全データをJSON保存", exact: true })
    .click();
  const file = await download;
  const path = await file.path();
  const { readFile } = await import("node:fs/promises");
  const json = await readFile(path!, "utf8");
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("JSONから復元（現在のデータを置換）").setInputFiles({
    name: "voice-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await expect(page.getByRole("status")).toContainText("データを復元しました");
  await expect(page.locator("audio")).toHaveCount(0);
  expect((await stored(page)).audioKeys).toEqual([]);
  await page.screenshot({
    path: "test-results/beta6-debug-audio.png",
    fullPage: true,
  });
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "バッファを削除", exact: true })
    .click();
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(page.locator("footer")).toContainText("LOCAL FIRST");
  snapshot = await stored(page);
  expect(snapshot.audioKeys).toEqual([]);
  expect((snapshot.state as { debug: unknown[] }).debug).toEqual([]);
});

test("voice mode can finish five chord questions without touching per-question controls", async ({
  page,
}) => {
  await mockVoice(page);
  await enableVoice(page, false, true);
  await start(page, 3);
  const phrases = [
    "ドメジャーセブン",
    "ドマイナーセブン",
    "ドセブン",
    "ドマイナーセブンフラットファイブ",
    "ドシャープメジャーセブン",
  ];
  for (const phrase of phrases) {
    await expect(
      page.getByRole("status").filter({ hasText: "音を待ちましょう" }),
    ).toBeVisible();
    await page.clock.runFor(7000);
    await expect(
      page.getByRole("status").filter({ hasText: "音名を話してください" }),
    ).toBeVisible();
    await emit(page, [phrase]);
  }
  await expect(
    page.getByRole("heading", { name: "5 / 5問正解" }),
  ).toBeVisible();
  await expect(page.locator(".big-score")).toContainText("25");
});

test("unsupported recognition falls back to buttons even with previously saved voice preferences", async ({
  page,
}) => {
  await mockVoice(page);
  await page.addInitScript(() => {
    Object.assign(window, {
      SpeechRecognition: undefined,
      webkitSpeechRecognition: undefined,
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "サポート", exact: false }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("JSONから復元（現在のデータを置換）").setInputFiles({
    name: "prefs.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        sessions: [],
        reviews: [],
        debug: [],
        settings: {
          notation: "sharp",
          range: "high",
          inputMode: "voice",
          voiceConsentVersion: 1,
        },
      }),
    ),
  });
  await expect(page.getByRole("status")).toContainText("データを復元しました");
  // Imported preferences cannot grant voice consent. Simulate a previously consented local profile separately.
  expect(
    ((await stored(page)).state as { settings: { inputMode: string } }).settings
      .inputMode,
  ).toBe("button");
  expect(await events(page)).toEqual([]);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("musicsensor", 2);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      const r = tx.objectStore("state").get("main");
      r.onsuccess = () => {
        const data = r.result;
        data.settings.inputMode = "voice";
        data.settings.voiceConsentVersion = 1;
        tx.objectStore("state").put(data, "main");
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "◖ MusicSensor" }).click();
  await page.getByRole("button", { name: "トレーニングをはじめる" }).click();
  await start(page);
  await expect(
    page.getByText("このブラウザは音声認識に対応していません。", {
      exact: false,
    }),
  ).toBeVisible();
  expect(await events(page)).toEqual([]);
  await page.getByRole("button", { name: "音を聴く" }).click();
  await page.clock.runFor(4000);
  await page.getByRole("button", { name: "C", exact: true }).click();
  await expect(page.getByText("正解！ +5点", { exact: false })).toBeVisible();
});

test("upgrades an existing Beta5 IndexedDB without losing sessions or enabling voice", async ({
  page,
}) => {
  await mockVoice(page);
  await page.route("**/src/main.tsx", async (route) => {
    await page.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("musicsensor", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("state");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("state", "readwrite");
          tx.objectStore("state").put(
            {
              schemaVersion: 1,
              sessions: [
                {
                  id: "beta5-existing",
                  started: "2026-10-24T00:00:00Z",
                  timezone: "Asia/Tokyo",
                  status: "interrupted",
                  total: 20,
                  level: 1,
                  mode: "normal",
                  attempts: [],
                },
              ],
              reviews: [],
              debug: [],
            },
            "main",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
    });
    await route.continue();
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "聴くことから、はじめよう。" }),
  ).toBeVisible();
  const snapshot = await stored(page);
  expect(
    (snapshot.state as { sessions: { id: string }[] }).sessions[0].id,
  ).toBe("beta5-existing");
  expect(snapshot.audioKeys).toEqual([]);
  expect(await events(page)).toEqual([]);
});
