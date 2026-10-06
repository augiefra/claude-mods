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

// below: what a mod placed after this one draws under the line.
function world(on: any, env: Record<string, string> = {}, stored: Record<string, unknown> = {}, below?: string) {
  mock.clock(on, { now: NOW });
  mock.store(on, stored);
  mock.env(on, env);
  on("session.id", () => ({ value: "session-1" }));
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.render", ($: any, e: any) => (below ? $.ui.resolve(e).Text({ children: below }) : $.ui.resolve(e).Box({ children: [] })));
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
    // The context in tokens alone; the weather word goes to the icon's tooltip.
    expect(texts).toContain("107k");
    expect(texts).not.toContain("11% context");
    expect(texts).toContain("5h");
    expect(texts).toContain("32%");
    const dot = surface === "terminal" ? "· " : "";
    // The time left alone; the reset time is in the clock's tooltip.
    expect(texts).toContain(`${dot}3h00`);
    expect(texts).not.toContain(`${dot}3h00 → ${at(NOW + 3 * 3_600_000)}`);
    expect(texts).toContain("59%");
    expect(texts).toContain(`${dot}3d00h`);
    // No request yet: the cache block waits, no cost without a ledger. In the app the bolt stands for the word.
    if (surface === "terminal") expect(texts).toContain("cache");
    expect(texts).toContain("—");
    if (surface === "desktop") {
      const svgs = (await ui.findAll({ type: "Svg" })) as any[];
      expect(svgs.some((s) => s.props?.alt === "Clear · 11% of 1M" && String(s.props?.source).includes("<title>"))).toBe(true);
      // Every interactive drawing declares a color scheme, or its frame turns white in dark mode.
      for (const s of svgs.filter((s) => s.props?.isInteractive)) expect(String(s.props?.source)).toContain("color-scheme:light dark");
      // Pills: tinted and rounded, without the border's vertical padding.
      const pills = ((await ui.findAll({ type: "Box" })) as any[]).filter((b) => b.props?.backgroundColor);
      expect(pills.length).toBe(4);
      for (const p of pills) {
        expect(p.props?.borderStyle).toBe("round");
        expect(p.props?.paddingY).toBe(0);
      }
    } else {
      expect(texts).toContain("☀");
      expect(texts).not.toContain("Clear");
    }
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
test("keeps what later mods draw under the line", async ($, on) => {
  world(on, {}, {}, "drawn after this mod");
  withUsage(on, LIMITS);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const { texts } = await band($, "terminal");
  expect(texts).toContain("drawn after this mod");
  expect(texts.indexOf("107k")).toBeLessThan(texts.indexOf("drawn after this mod"));
});

test("auto: French when LANG is French", async ($, on) => {
  world(on, { LANG: "fr_FR.UTF-8" });
  withUsage(on, LIMITS);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const { texts } = await band($, "terminal");
  expect(texts).toContain("107k");
  expect(texts).toContain("32 %");
  expect(texts).toContain("7j");
  expect(texts).toContain("· 3j00h");
});

test("auto: LC_ALL comes before LANG", async ($, on) => {
  world(on, { LC_ALL: "fr_CA.UTF-8", LANG: "en_US.UTF-8" });
  withUsage(on, LIMITS);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const { texts } = await band($, "terminal");
  expect(texts).toContain("7j");
});

test("auto: English when LANG is another language", async ($, on) => {
  world(on, { LANG: "de_DE.UTF-8" });
  withUsage(on, LIMITS);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const { texts } = await band($, "terminal");
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
    expect(texts).toContain("210k");
    expect(texts).toContain("▲ +10k");
    if (surface === "terminal") {
      expect(texts).toContain("☀");
      // Earlier prompts in grey (+20k then +80k, the heaviest), current prompt (+10k) in color.
      expect(texts).toContain("▃█");
      const now: any = await ui.find({ type: "Text", text: "▂" });
      expect(now?.props?.color).toBe("yellow");
    } else {
      const svgs = (await ui.findAll({ type: "Svg" })) as any[];
      // Drawn weather icon, turn bars, two gauges; every drawing carries its alt text.
      const alts = svgs.map((s) => String(s.props?.alt ?? ""));
      expect(alts.every((a) => a.length > 0)).toBe(true);
      expect(alts.filter((a) => a.startsWith("Tokens added") || a.includes(" used") || a.startsWith("Clear")).length).toBe(4);
      // Small icons: gauge, calendar, two reset clocks, cache.
      for (const a of ["5-hour limit", "7-day limit", "Resets in", "Prompt cache"]) expect(alts).toContain(a);
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
  expect(texts).not.toContain("· 3h00");
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
      // 6 cells: 2 grey margin cells (5 h), 2 red cells ahead (7 d).
      expect(dashes.filter((d) => d.props?.dimColor).length).toBe(2);
      expect(dashes.filter((d) => d.props?.color === "red").length).toBe(2);
    } else {
      const svgs = (await ui.findAll({ type: "Svg" })) as any[];
      const gauges = svgs.filter((s) => String(s.props?.alt ?? "").includes("used"));
      expect(gauges.length).toBe(2);
      for (const g of gauges) expect(String(g.props?.source)).toContain("<pattern");
      expect(svgs.some((s) => String(s.props?.source).includes("#4f8ef7"))).toBe(false);
    }
  });
}

// ---------- Prompt cache and cost ----------

// One main-loop request answered with this usage.
async function step($: any, usage: Record<string, unknown>, model = "claude-opus-5-5") {
  const stream = $.turn.step({ turnId: "t", index: 0, model, messageCount: 2 });
  for await (const _ of stream) {
  }
  return stream.result;
}

function engineStep(on: any, usages: Record<string, unknown>[]) {
  let call = 0;
  on("turn.step", async function* () {
    const usage = usages[Math.min(call++, usages.length - 1)];
    return { turnId: "t", index: 0, answer: "", toolUses: [], stopReason: "end_turn", usage };
  });
}

const HIT = { model: "claude-opus-5-5", input_tokens: 300, cache_read_input_tokens: 98_000, cache_creation_input_tokens: 1_700, output_tokens: 500 };
const MISS = { model: "claude-opus-5-5", input_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 99_700, output_tokens: 500 };

test("cache: share read and time left on a subscription (1 hour)", async ($, on) => {
  world(on);
  withUsage(on, LIMITS);
  engineStep(on, [HIT]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await step($, HIT);
  const { ui, texts } = await band($, "terminal");
  expect(texts).toContain("cache");
  // 98% served: the time left alone (1 hour, counted from the request's start).
  expect(texts).not.toContain("98%");
  expect(texts).toContain("1h00");
  const time: any = await ui.find({ type: "Text", text: "1h00" });
  expect(time?.props?.bold).toBe(true);
  expect(time?.props?.color).toBeUndefined();
});

test("cache: yellow under 10 minutes, then expired with /compact", async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  mock.store(on, {});
  mock.env(on, {});
  on("session.id", () => ({ value: "session-1" }));
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
  withUsage(on, LIMITS);
  engineStep(on, [HIT]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await step($, HIT);
  await (clock as any).advance(55 * 60_000);
  let { ui, texts } = await band($, "terminal");
  expect(texts).toContain("5 min");
  const soon: any = await ui.find({ type: "Text", text: "5 min" });
  expect(soon?.props?.color).toBe("yellow");
  await (clock as any).advance(6 * 60_000);
  ({ ui, texts } = await band($, "terminal"));
  expect(texts).toContain("expired");
  // 107k of context: past 100k, what gets written again and /compact before going on.
  expect(texts).toContain("· 107k to rewrite · /compact");
  const expired: any = await ui.find({ type: "Text", text: "expired" });
  expect(expired?.props?.color).toBe("red");
});

test("cache: a miss after a model change names the cause", async ($, on) => {
  world(on);
  withUsage(on, LIMITS);
  engineStep(on, [HIT, { ...MISS, model: "claude-sonnet-5-5" }]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await step($, HIT);
  await step($, MISS, "claude-sonnet-5-5");
  const { texts } = await band($, "terminal");
  expect(texts).toContain("0%");
  expect(texts).toContain("· missed · model changed");
});

test("cache: 5 minutes on an API key (no plan window)", async ($, on) => {
  world(on);
  withUsage(on, []);
  engineStep(on, [HIT]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await step($, HIT);
  const { texts } = await band($, "terminal");
  expect(texts).toContain("5 min");
});

test("cost: shown in dollars, French format", async ($, on) => {
  world(on, { LANG: "fr_FR.UTF-8" });
  on("session.usage", () => ({ value: { startedAt: NOW, context: { tokens: 107_000, window: 1_000_000, percent: 11 }, rateLimits: LIMITS, cost: { usd: 4.321 } } }));
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  for (const surface of ["terminal", "desktop"] as const) {
    const { ui, texts } = await band($, surface);
    expect(texts).toContain("≈ 4,32 $");
    if (surface === "desktop") {
      const svgs = (await ui.findAll({ type: "Svg" })) as any[];
      expect(svgs.some((s) => s.props?.alt === "Coût du fil" && String(s.props?.source).includes("#b8892a"))).toBe(true);
    }
  }
});

test("cost: the last prompt's share next to the total", async ($, on) => {
  world(on);
  on("turn.complete", () => ({ text: "" }));
  const costs = [4.0, 4.84];
  let call = 0;
  on("session.usage", () => ({ value: { startedAt: NOW, context: { tokens: 107_000 + call * 1_000, window: 1_000_000, percent: 11 }, rateLimits: LIMITS, cost: { usd: costs[Math.min(call++, costs.length - 1)] } } }));
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await ($ as any).turn.complete({ answer: "ok" } as any);
  const terminal = await band($, "terminal");
  expect(terminal.texts).toContain("≈ $4.84");
  expect(terminal.texts).toContain("(+$0.84)");
  const desktop = await band($, "desktop");
  expect(desktop.texts).toContain("+$0.84");
  const svgs = (await desktop.ui.findAll({ type: "Svg" })) as any[];
  expect(svgs.some((s) => s.props?.alt === "Last prompt")).toBe(true);
});

test("agents: a pill while subagents run, gone once they finish", async ($, on) => {
  world(on);
  withUsage(on, LIMITS);
  let list = [
    { id: "a1", description: "Review the diff", type: "Plan", status: "running" },
    { id: "a2", description: "Search the repo", type: "Explore", status: "running" },
    { id: "a0", description: "Earlier", type: "Explore", status: "completed" },
  ];
  on("agent.list", () => ({ value: list }));
  on("turn.complete", () => ({ text: "" }));
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const desktop = await band($, "desktop");
  expect(desktop.texts).toContain("2 agents");
  const svgs = (await desktop.ui.findAll({ type: "Svg" })) as any[];
  const robot = svgs.find((s) => s.props?.alt === "Agents running");
  expect(String(robot?.props?.source)).toContain("Plan · Review the diff");
  expect(robot?.props?.isInteractive).toBe(true);
  list = list.map((a) => ({ ...a, status: "completed" }));
  await ($ as any).turn.complete({ answer: "ok", agentId: "a1" } as any);
  const after = await band($, "terminal");
  expect(after.texts.some((t: string) => t.includes("agent"))).toBe(false);
});

// ---------- Heavy thread ----------

function heavyWorld(on: any, tokens: number, stored: Record<string, unknown> = {}) {
  world(on, {}, stored);
  withUsage(on, LIMITS, { tokens, window: 1_000_000, percent: Math.round(tokens / 10_000) });
}

test("heavy thread: hidden under 300k", async ($, on) => {
  heavyWorld(on, 250_000);
  await $.session.start({ source: "resume", cwd: "/tmp" } as any);
  const { texts } = await band($, "terminal");
  expect(texts).not.toContain("heavy thread");
});

for (const surface of ["terminal", "desktop"] as const) {
  test(`heavy thread: yellow from 300k, against the measured baseline ${surface}`, async ($, on) => {
    // Fresh sessions started at 120k and 114k: the baseline is the smallest.
    heavyWorld(on, 342_000, { baseline: { at: NOW, list: [120_000, 114_000] } });
    await $.session.start({ source: "resume", cwd: "/tmp" } as any);
    const { ui, texts } = await band($, surface);
    if (surface === "terminal") {
      expect(texts).toContain("×3");
      const times: any = await ui.find({ type: "Text", text: "×3" });
      expect(times?.props?.color).toBe("yellow");
      expect(texts).toContain("heavy thread");
      expect(texts).toContain("· start a new thread");
    } else {
      // In the app: bag and figure in one interactive drawing; the words and the advice sit in its tooltip.
      expect(texts).not.toContain("heavy thread");
      expect(texts).not.toContain("×3");
      const svgs = (await ui.findAll({ type: "Svg" })) as any[];
      const pill = svgs.find((s) => s.props?.alt === "Heavy thread");
      const source = String(pill?.props?.source);
      expect(pill?.props?.isInteractive).toBe(true);
      expect(source).toContain("color-scheme:light dark");
      expect(source).toContain(">×3</text>");
      expect(source).toContain('fill="#d9962b"');
      expect(source).toContain(
        "<title>Heavy thread: 342k tokens of context, 3 times your starting load (114k).\nEvery action reads the whole context again: start a new thread.</title>",
      );
      // 16 px high, wide enough for the bag and the figure.
      expect(pill?.props?.height).toBe(16);
      expect(pill?.props?.width).toBe(41);
      expect(source).toContain('viewBox="0 0 61.5 24"');
    }
  });
}

test("heavy thread: red from 500k, 100k baseline until one is measured", async ($, on) => {
  heavyWorld(on, 652_000);
  await $.session.start({ source: "resume", cwd: "/tmp" } as any);
  const { ui, texts } = await band($, "terminal");
  expect(texts).toContain("×6.5");
  const times: any = await ui.find({ type: "Text", text: "×6.5" });
  expect(times?.props?.color).toBe("red");
});

test("heavy thread: the app's tooltip in French", async ($, on) => {
  world(on, { LANG: "fr_FR.UTF-8" });
  withUsage(on, LIMITS, { tokens: 612_000, window: 1_000_000, percent: 61 });
  await $.session.start({ source: "resume", cwd: "/tmp" } as any);
  const { ui } = await band($, "desktop");
  const svgs = (await ui.findAll({ type: "Svg" })) as any[];
  const pill = svgs.find((s) => s.props?.alt === "Fil lourd");
  const source = String(pill?.props?.source);
  expect(pill?.props?.isInteractive).toBe(true);
  expect(source).toContain(">×6,1</text>");
  // Red from 500k.
  expect(source).toContain('fill="#d64545"');
  expect(source).toContain(
    "<title>Fil lourd : 612k tokens de contexte, 6,1 fois le départ d'un fil neuf (100k).\nChaque action relit tout le contexte : ouvre un nouveau fil.</title>",
  );
});

test("desktop icons: bag, gauge and speech bubble centred at y=12", async ($, on) => {
  world(on);
  on("turn.complete", () => ({ text: "" }));
  const costs = [4.0, 4.84];
  let call = 0;
  on("session.usage", () => ({ value: { startedAt: NOW, context: { tokens: 400_000 + call * 1_000, window: 1_000_000, percent: 40 }, rateLimits: LIMITS, cost: { usd: costs[Math.min(call++, costs.length - 1)] } } }));
  await $.session.start({ source: "resume", cwd: "/tmp" } as any);
  await ($ as any).turn.complete({ answer: "ok" } as any);
  const { ui } = await band($, "desktop");
  const svgs = (await ui.findAll({ type: "Svg" })) as any[];
  const source = (alt: string) => String(svgs.find((s) => s.props?.alt === alt)?.props?.source);
  expect(source("Heavy thread")).toContain('d="M8.6 7.5a3.4 3.4 0 1 1 6.8 0"');
  expect(source("Heavy thread")).toContain('d="M6.2 7.5h11.6l2 10.4a1.6 1.6 0 0 1-1.6 1.9H5.8a1.6 1.6 0 0 1-1.6-1.9z"');
  expect(source("5-hour limit")).toContain('<g transform="translate(0 0.5)"><path d="M3.6 18.5');
  expect(source("Last prompt")).toContain('<g transform="translate(0 0.5)"><path d="M4 5.5');
});

test("heavy thread: a fresh session records its starting load", async ($, on) => {
  const store = new Map<string, unknown>([["baseline", { at: NOW, list: [130_000] }]]);
  mock.clock(on, { now: NOW });
  mock.env(on, {});
  on("store.get", (_$: any, e: any) => ({ value: store.get(e.key) }));
  on("store.set", (_$: any, e: any) => (store.set(e.key, e.value), { value: undefined }));
  on("store.delete", (_$: any, e: any) => (store.delete(e.key), { value: undefined }));
  on("store.keys", () => ({ value: [...store.keys()] }));
  on("session.id", () => ({ value: "session-2" }));
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
  on("turn.complete", () => ({ text: "" }));
  let call = 0;
  on("session.usage", () => ({ value: { startedAt: NOW, context: { tokens: call++ === 0 ? 0 : 112_000, window: 1_000_000, percent: 11 }, rateLimits: LIMITS } }));
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await ($ as any).turn.complete({ answer: "ok" } as any);
  expect((store.get("baseline") as any).list).toEqual([130_000, 112_000]);
});

test("cache expired on a heavy thread: what gets written again, and a new thread", async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  mock.store(on, {});
  mock.env(on, {});
  on("session.id", () => ({ value: "session-1" }));
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
  withUsage(on, LIMITS, { tokens: 741_000, window: 1_000_000, percent: 74 });
  engineStep(on, [HIT]);
  await $.session.start({ source: "resume", cwd: "/tmp" } as any);
  await step($, HIT);
  await (clock as any).advance(61 * 60_000);
  const { texts } = await band($, "terminal");
  expect(texts).toContain("· 741k to rewrite");
  // The way out sits once, in the heavy-thread pill.
  expect(texts.filter((t: string) => t.includes("start a new thread")).length).toBe(1);
});

test("last prompt: its share of the 5-hour limit next to its cost", async ($, on) => {
  world(on, { LANG: "fr_FR.UTF-8" });
  on("turn.complete", () => ({ text: "" }));
  const steps = [
    { usd: 4.0, five: 30 },
    { usd: 5.07, five: 32.5 },
  ];
  let call = 0;
  on("session.usage", () => {
    const s = steps[Math.min(call++, steps.length - 1)];
    return { value: { startedAt: NOW, context: { tokens: 107_000 + call * 1_000, window: 1_000_000, percent: 11 }, rateLimits: [{ ...LIMITS[1], percentUsed: s.five }, LIMITS[0]], cost: { usd: s.usd } } };
  });
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await ($ as any).turn.complete({ answer: "ok" } as any);
  const { texts } = await band($, "terminal");
  expect(texts).toContain("(+1,07 $ · +2,5 % 5h)");
});

test("cache: below 90% served, the share before the time", async ($, on) => {
  world(on);
  withUsage(on, LIMITS);
  const PART = { ...HIT, cache_read_input_tokens: 72_000, cache_creation_input_tokens: 0, input_tokens: 28_000 };
  engineStep(on, [PART]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await step($, PART);
  const { texts } = await band($, "terminal");
  expect(texts).toContain("72%");
  expect(texts).toContain("· 1h00");
});

test("cost: no cents from 100 dollars", async ($, on) => {
  world(on);
  on("session.usage", () => ({ value: { startedAt: NOW, context: { tokens: 107_000, window: 1_000_000, percent: 11 }, rateLimits: LIMITS, cost: { usd: 134.69 } } }));
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const { texts } = await band($, "terminal");
  expect(texts).toContain("≈ $135");
});

test("desktop: pills never shrink, and the 5-hour reset time sits in the clock's tooltip", async ($, on) => {
  world(on);
  withUsage(on, LIMITS);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const { ui } = await band($, "desktop");
  const pills = ((await ui.findAll({ type: "Box" })) as any[]).filter((b) => b.props?.backgroundColor);
  for (const p of pills) expect(p.props?.flexShrink).toBe(0);
  const svgs = (await ui.findAll({ type: "Svg" })) as any[];
  expect(svgs.some((s) => s.props?.isInteractive && String(s.props?.source).includes(`Resets at ${at(NOW + 3 * 3_600_000)}`))).toBe(true);
});
