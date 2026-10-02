import { test, expect, mock } from "claude-code/testing";

// October 2, 2026, 13:00 UTC.
const NOW = Date.UTC(2026, 9, 2, 13, 0);
// The 5-hour reset time is shown in the machine's time zone.
const at = (ms: number) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
const LIMITS = [
  // 7 days: 59% used, 4 of 7 days elapsed (57%): slightly ahead, yellow.
  { kind: "seven_day", percentUsed: 59, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString() },
  // 5 hours: 32% used, 2 of 5 hours elapsed (40%): behind time, green.
  { kind: "five_hour", percentUsed: 32, resetsAt: new Date(NOW + 3 * 3_600_000).toISOString() },
];

function world(on: any, env: Record<string, string> = {}, stored: Record<string, unknown> = {}) {
  mock.clock(on, { now: NOW });
  mock.store(on, stored);
  mock.env(on, env);
  on("session.id", () => ({ value: "session-1" }));
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
}

function withUsage(on: any, rateLimits: unknown[], context = { tokens: 107_000, window: 1_000_000, percent: 11 }) {
  on("session.usage", () => ({ value: { startedAt: NOW, context, rateLimits } }));
}

async function band($: any, surface: "terminal" | "desktop", columns = 200) {
  const ui = await $.ui.mount({ plugin: "token-weather-usage", surface, component: "AbovePrompt", props: { bodyColumns: columns } as any });
  const texts = (await ui.findAll({ type: "Text" })).map((t: any) => t.text);
  return { ui, texts };
}

for (const surface of ["terminal", "desktop"] as const) {
  test(`band ${surface}`, async ($, on) => {
    world(on);
    withUsage(on, LIMITS);
    await $.session.start({ source: "startup", cwd: "/tmp" } as any);
    const { ui, texts } = await band($, surface);
    expect(texts).toContain("Clear");
    expect(texts).toContain("11% context");
    expect(texts).toContain("5h");
    expect(texts).toContain("32%");
    expect(texts).toContain(`· 3h00 → ${at(NOW + 3 * 3_600_000)}`);
    expect(texts).toContain("59%");
    expect(texts).toContain("· 3d00h");
    // 5 hours before 7 days, whatever the order received.
    expect(texts.indexOf("5h")).toBeLessThan(texts.indexOf("7d"));
    // A single reading: no turns chart yet.
    expect(texts).not.toContain("turns");
    // Outside an alert, the percentage keeps the theme's color.
    const value: any = await ui.find({ type: "Text", text: "59%" });
    expect(value?.props?.color).toBeUndefined();
    expect(value?.props?.bold).toBe(true);
  });
}

// The language option (en, fr) is not tested here: test(name, { options }, body) does not reach
// register() in Claude Code 2.1.286. It was checked in a real session instead.
test("auto: French when LANG is French", async ($, on) => {
  world(on, { LANG: "fr_FR.UTF-8" });
  withUsage(on, LIMITS);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const { texts } = await band($, "terminal");
  expect(texts).toContain("Clair");
  expect(texts).toContain("11 % contexte");
  expect(texts).toContain("32 %");
  expect(texts).toContain("7j");
  expect(texts).toContain("· 3j00h");
});

test("auto: LC_ALL comes before LANG", async ($, on) => {
  world(on, { LC_ALL: "fr_CA.UTF-8", LANG: "en_US.UTF-8" });
  withUsage(on, LIMITS);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const { texts } = await band($, "terminal");
  expect(texts).toContain("Clair");
});

test("auto: English when LANG is another language", async ($, on) => {
  world(on, { LANG: "de_DE.UTF-8" });
  withUsage(on, LIMITS);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const { texts } = await band($, "terminal");
  expect(texts).toContain("Clear");
  expect(texts).toContain("7d");
});

test("a window that already reset is hidden", async ($, on) => {
  world(on);
  withUsage(on, [
    { kind: "five_hour", percentUsed: 80, resetsAt: new Date(NOW - 60_000).toISOString() },
    { kind: "seven_day", percentUsed: 59, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString() },
  ]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const { texts } = await band($, "terminal");
  expect(texts).not.toContain("5h");
  expect(texts).toContain("7d");
});

for (const surface of ["terminal", "desktop"] as const) {
  test(`turns after two readings ${surface}`, async ($, on) => {
    world(on);
    on("turn.complete", () => ({ text: "" }));
    // 4 readings: +20k, +80k, +10k tokens.
    const fills = [10, 12, 20, 21];
    let call = 0;
    on("session.usage", () => {
      const percent = fills[Math.min(call++, fills.length - 1)];
      return { value: { startedAt: NOW, context: { tokens: percent * 10_000, window: 1_000_000, percent }, rateLimits: LIMITS } };
    });
    await $.session.start({ source: "startup", cwd: "/tmp" } as any);
    for (let i = 0; i < 3; i++) await ($ as any).turn.complete({ answer: "ok" } as any);
    const { ui, texts } = await band($, surface);
    expect(texts).toContain("turns");
    expect(texts).toContain("Clear");
    expect(texts).toContain("▲ +10k");
    if (surface === "terminal") {
      expect(texts).toContain("☀");
      // Earlier prompts in grey (+20k then +80k, the heaviest), current prompt (+10k) in color.
      expect(texts).toContain("▃█");
      const now: any = await ui.find({ type: "Text", text: "▂" });
      expect(now?.props?.color).toBe("yellow");
    } else {
      const svgs = await ui.findAll({ type: "Svg" });
      // Drawn weather icon, turn bars, two gauges.
      expect(svgs.length).toBe(4);
      expect(texts).not.toContain("☀");
    }
  });
}

test("on start, the shared reading wins over an old local one", async ($, on) => {
  // Another session measured 63% two minutes ago.
  world(on, {}, {
    limits: { at: NOW - 120_000, list: [{ kind: "five_hour", percentUsed: 63, resetsAt: new Date(NOW + 3 * 3_600_000).toISOString() }] },
  });
  // This idle session still holds an old reading at 34%.
  withUsage(on, [{ kind: "five_hour", percentUsed: 34, resetsAt: new Date(NOW + 3 * 3_600_000).toISOString() }]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const { texts } = await band($, "terminal");
  expect(texts).toContain("63%");
  expect(texts).not.toContain("34%");
});

test("alert: percentage in red at 90% or more", async ($, on) => {
  world(on);
  withUsage(on, [{ kind: "five_hour", percentUsed: 95, resetsAt: new Date(NOW + 3 * 3_600_000).toISOString() }]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const { ui } = await band($, "desktop");
  const value: any = await ui.find({ type: "Text", text: "95%" });
  expect(value?.props?.color).toBe("red");
});

test("narrow terminal: no bar, no detail", async ($, on) => {
  world(on);
  withUsage(on, LIMITS);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const { texts } = await band($, "terminal", 60);
  expect(texts).toContain("32%");
  expect(texts).not.toContain("━");
  expect(texts).not.toContain(`· 3h00 → ${at(NOW + 3 * 3_600_000)}`);
});

test("after a restart, the turn bars come back", async ($, on) => {
  mock.clock(on, { now: NOW });
  mock.env(on, {});
  // In-memory store: this session already had 3 readings (+20k, then +80k); another one has slept for 9 days.
  const store = new Map<string, unknown>([
    ["turns:session-1", { at: NOW - 60_000, readings: [10, 12, 20].map((p) => ({ tokens: p * 10_000, window: 1_000_000, percent: p })) }],
    ["turns:old-session", { at: NOW - 9 * 86_400_000, readings: [] }],
  ]);
  on("store.get", (_$: any, e: any) => ({ value: store.get(e.key) }));
  on("store.set", (_$: any, e: any) => (store.set(e.key, e.value), { value: undefined }));
  on("store.delete", (_$: any, e: any) => (store.delete(e.key), { value: undefined }));
  on("store.keys", () => ({ value: [...store.keys()] }));
  on("session.id", () => ({ value: "session-1" }));
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
  // On reopening, the context equals the last reading: no duplicate reading.
  withUsage(on, LIMITS, { tokens: 200_000, window: 1_000_000, percent: 20 });
  await $.session.start({ source: "resume", cwd: "/tmp" } as any);
  const { texts } = await band($, "terminal");
  expect(texts).toContain("turns");
  expect(texts).toContain("▲ +80k");
  // The session idle for more than 8 days is deleted, not this one.
  expect(store.has("turns:old-session")).toBe(false);
  expect(store.has("turns:session-1")).toBe(true);
});

for (const surface of ["terminal", "desktop"] as const) {
  test(`gap with elapsed time hatched ${surface}`, async ($, on) => {
    world(on);
    withUsage(on, [
      // 5 hours: 74% used, window 99% over: margin left.
      { kind: "five_hour", percentUsed: 74, resetsAt: new Date(NOW + 3 * 60_000).toISOString() },
      // 7 days: 80% used for 57% elapsed: ahead of time (alert).
      { kind: "seven_day", percentUsed: 80, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString() },
    ]);
    await $.session.start({ source: "startup", cwd: "/tmp" } as any);
    const { ui } = await band($, surface);
    if (surface === "terminal") {
      const dashes = (await ui.findAll({ type: "Text", text: "╍" })) as any[];
      // 2 grey margin cells (5 h), 1 red cell ahead (7 d).
      expect(dashes.filter((d) => d.props?.dimColor).length).toBe(2);
      expect(dashes.filter((d) => d.props?.color === "red").length).toBe(1);
    } else {
      const svgs = (await ui.findAll({ type: "Svg" })) as any[];
      const gauges = svgs.filter((s) => String(s.props?.alt ?? "").includes("used"));
      expect(gauges.length).toBe(2);
      for (const g of gauges) expect(String(g.props?.source)).toContain("<pattern");
      expect(svgs.some((s) => String(s.props?.source).includes("#4f8ef7"))).toBe(false);
    }
  });
}
