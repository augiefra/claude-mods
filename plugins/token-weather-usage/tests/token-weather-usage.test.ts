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
  const clock = mock.clock(on, { now: NOW });
  mock.store(on, stored);
  mock.env(on, env);
  on("session.id", () => ({ value: "session-1" }));
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.render", ($: any, e: any) => (below ? $.ui.resolve(e).Text({ children: below }) : $.ui.resolve(e).Box({ children: [] })));
  return clock as any;
}

function withUsage(on: any, rateLimits: unknown[], context = { tokens: 107_000, window: 1_000_000, percent: 11 }) {
  on("session.usage", () => ({ value: { startedAt: NOW, context, rateLimits } }));
}

async function band($: any, surface: "terminal" | "desktop", columns = 200) {
  const ui = await $.ui.mount({ plugin: "token-weather-usage", surface, component: "AbovePrompt", props: { bodyColumns: columns } as any });
  // The hover cards' lines are hidden until hovered: left out of the band's texts.
  const hidden = ((await ui.findAll({ type: "Box" })) as any[])
    .filter((b) => b.props?.position === "absolute")
    .flatMap((b) => ((b.children ?? []) as any[]).map((t) => strings(t).join("")));
  const texts: string[] = [];
  for (const t of (await ui.findAll({ type: "Text" })) as any[]) {
    const i = hidden.indexOf(t.text);
    if (i >= 0) hidden.splice(i, 1);
    else texts.push(t.text);
  }
  return { ui, texts };
}

// The hover cards drawn inside the pills, as element descriptions.
async function cardNodes(ui: any): Promise<any[]> {
  const pills = ((await ui.findAll({ type: "Box" })) as any[]).filter((b) => b.key);
  return pills.flatMap((p) => ((p.children ?? []) as any[]).filter((c) => c && typeof c === "object" && c.props?.position === "absolute"));
}

// Every string beneath a drawn element description, in order.
function strings(node: any): string[] {
  if (node == null || node === false) return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(strings);
  return strings(node.children ?? node.props?.children);
}

// The hover card of a pill (by its key), its lines joined by newlines; null without one.
async function cardOf(ui: any, pillKey: string): Promise<string | null> {
  const pill: any = await ui.find({ type: "Box", key: pillKey });
  const kids = (pill?.children ?? []) as any[];
  const card = kids.find((c) => c && typeof c === "object" && c.props?.position === "absolute");
  if (!card) return null;
  const lines = ((card.children ?? card.props?.children ?? []) as any[]).map((t) => strings(t).join(""));
  return lines.join("\n");
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
      // The weather word sits in the context pill's hover card; no drawing is interactive any more
      // (the app shows no SVG tooltip).
      expect(svgs.some((s) => s.props?.alt === "Clear · 11% of 1M")).toBe(true);
      expect(await cardOf(ui, "context")).toBe("Clear · 11% of 1M");
      for (const s of svgs) expect(s.props?.isInteractive).toBeFalsy();
      // No request yet: no card on the cache pill.
      expect(await cardOf(ui, "cache")).toBeNull();
      // Hover cards: hidden, revealed by the pill's hover, in the theme's colors.
      const cards = await cardNodes(ui);
      expect(cards.length).toBeGreaterThan(0);
      for (const c of cards) {
        expect(c.props?.display).toBe("none");
        expect((c.hover ?? c.props?.hover)?.display).toBe("flex");
        expect(c.props?.backgroundColor).toBe("background");
        expect(c.props?.key).toBeUndefined();
      }
      // Pills: tinted and rounded, without the border's vertical padding.
      const pills = ((await ui.findAll({ type: "Box" })) as any[]).filter((b) => b.props?.backgroundColor && b.props?.position !== "absolute");
      // Context, 5 hours, 7 days, cache, and the agents pill, which stays in the app.
      expect(pills.length).toBe(5);
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

test("auto: Russian when LANG is Russian", async ($, on) => {
  world(on, { LANG: "ru_RU.UTF-8" });
  withUsage(on, LIMITS);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const { texts } = await band($, "terminal");
  expect(texts).toContain("107k");
  expect(texts).toContain("5ч");
  expect(texts).toContain("7д");
  expect(texts).toContain("· 3д00ч");
  expect(texts).toContain("кэш");
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

// The mod's list prices for the models used here, USD per million tokens (Anthropic, 2026-10-07).
// Haiku 5.5 costs 5× more past 100k tokens of prompt.
const PRICE: Record<string, { input: number; read: number }> = {
  "claude-opus-5-5": { input: 4, read: 0.2 },
  "claude-sonnet-5-5": { input: 2, read: 0.1 },
  "claude-haiku-5-5": { input: 0.1, read: 0.01 },
  "claude-haiku-5-5 over 100k": { input: 0.5, read: 0.05 },
  "claude-haiku-4-5": { input: 1, read: 0.1 },
};
// LIMITS means a subscription within its plan: the 1-hour lifetime, whose cache writes cost 2× input.
const write1h = (model = "claude-opus-5-5") => 2 * PRICE[model].input;
const readCost = (tokens: number, model = "claude-opus-5-5") => (tokens * PRICE[model].read) / 1e6;
const rewriteCost = (tokens: number, model = "claude-opus-5-5") => (tokens * write1h(model)) / 1e6;
const savedBy = (read: number, model = "claude-opus-5-5") => (read * (PRICE[model].input - PRICE[model].read)) / 1e6;
// The mod's money format, for amounts between a cent and 100 dollars.
const en$ = (usd: number) => `$${usd.toFixed(2)}`;
const fr$ = (usd: number) => `${usd.toFixed(2).replace(".", ",")} $`;

// The cache pill's hover card in the app; null without one.
async function boltTip(ui: any): Promise<string | null> {
  return cardOf(ui, "cache");
}

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
  expect(soon?.props?.color).toBe("#a8690a");
  // What letting it lapse costs: the 107k context written again (1 hour lifetime), dim.
  const stake: any = await ui.find({ type: "Text", text: `· ${en$(rewriteCost(107_000))} at stake` });
  expect(stake?.props?.dimColor).toBe(true);
  const desktop = await band($, "desktop");
  expect(desktop.texts).toContain(`${en$(rewriteCost(107_000))} at stake`);
  const yellow: any = await desktop.ui.find({ type: "Text", text: "5 min" });
  expect(yellow?.props?.color).toBe("#a8690a");
  expect(await boltTip(desktop.ui)).toBe(
    `The cache expires at ${at(NOW + 3_600_000)}. Send your next message before then, or it writes 107k tokens again (≈ ${en$(rewriteCost(107_000))} instead of ≈ ${en$(readCost(107_000))}).`,
  );
  await (clock as any).advance(6 * 60_000);
  ({ ui, texts } = await band($, "terminal"));
  expect(texts).toContain("expired");
  // 107k of context: past 100k, what gets written again, its price, and /compact before going on.
  expect(texts).toContain(`· 107k to rewrite ≈ ${en$(rewriteCost(107_000))} · /compact`);
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
  // The surcharge: 99.7k tokens written (Sonnet 5.5, 1 hour) instead of read from the cache.
  const surcharge = (99_700 * (write1h("claude-sonnet-5-5") - PRICE["claude-sonnet-5-5"].read)) / 1e6;
  expect(texts).toContain(`· missed · model changed · +${en$(surcharge)}`);
  const desktop = await band($, "desktop");
  expect(desktop.texts).toContain(`missed · model changed · +${en$(surcharge)}`);
  expect(await boltTip(desktop.ui)).toBe(
    `This message read only 0% from the cache (model changed): it wrote 99.7k tokens again, ≈ ${en$(surcharge)} more than a message served by the cache.`,
  );
});

test("cache: Haiku 5.5 priced by prompt size", async ($, on) => {
  const clock = mock.clock(on, { now: NOW });
  mock.store(on, {});
  mock.env(on, {});
  on("session.id", () => ({ value: "session-1" }));
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
  withUsage(on, LIMITS);
  const haiku = { ...HIT, model: "claude-haiku-5-5" };
  engineStep(on, [haiku]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await step($, haiku, "claude-haiku-5-5");
  await (clock as any).advance(55 * 60_000);
  // The 107k context is past 100k: written again at the higher price.
  const over = "claude-haiku-5-5 over 100k";
  const { texts } = await band($, "desktop");
  expect(texts).toContain(`${en$(rewriteCost(107_000, over))} at stake`);
  expect(texts).not.toContain(`${en$(rewriteCost(107_000, "claude-haiku-5-5"))} at stake`);
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

test("cost: the last prompt's share, next to the total in the terminal, in the card in the app", async ($, on) => {
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
  expect(desktop.texts).toContain("≈ $4.84");
  expect(desktop.texts).not.toContain("+$0.84");
  expect(await cardOf(desktop.ui, "cost")).toBe(
    "Thread cost ≈ $4.84\nAt API prices: a subscription is not billed per token, this counts toward its limits.\nLast prompt: +$0.84",
  );
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
  expect(desktop.texts).toContain("2 running · 2");
  const card = String(await cardOf(desktop.ui, "agents"));
  expect(card).toContain("Agents in this thread: 2 (2 running)");
  expect(card).toContain("Running: Plan · “Review the diff” · < 1 min");
  expect((await band($, "terminal")).texts).toContain("2 running · 2");
  list = list.map((a) => ({ ...a, status: "completed" }));
  await ($ as any).turn.complete({ answer: "ok", agentId: "a1" } as any);
  // None ran a request: the terminal drops the block, the app keeps the pill at 0.
  const after = await band($, "terminal");
  expect(after.texts.some((t: string) => t.includes("agent") || t.includes("running"))).toBe(false);
  const app = await band($, "desktop");
  expect(app.texts).toContain("0");
  expect(await cardOf(app.ui, "agents")).toBe("Agents in this thread: 0\nNo subagent in this thread yet.");
});

test("agents: the card splits the cost by model and effort, and what delegating saved", async ($, on) => {
  world(on);
  on("session.usage", () => ({ value: { startedAt: NOW, context: { tokens: 107_000, window: 1_000_000, percent: 11 }, rateLimits: LIMITS, cost: { usd: 10 } } }));
  on("agent.list", () => ({
    value: [
      { id: "h1", description: "List the files", type: "Explore", status: "completed" },
      { id: "h2", description: "Check the captures", type: "general-purpose", status: "completed" },
      { id: "s1", description: "Sum up the README", type: "general-purpose", status: "completed" },
    ],
  }));
  on("turn.complete", () => ({ text: "" }));
  // 98k tokens a request, under Haiku 5.5's 100k threshold.
  const work = { input_tokens: 2_000, cache_read_input_tokens: 70_000, cache_creation_input_tokens: 6_000, output_tokens: 20_000 };
  engineStep(on, [HIT, { ...work, model: "claude-haiku-5-5" }, { ...work, model: "claude-haiku-5-5" }, { ...work, model: "claude-sonnet-5-5" }]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await step($, HIT);
  for (const [agentId, model, effort] of [["h1", "claude-haiku-5-5", "medium"], ["h2", "claude-haiku-5-5", "high"], ["s1", "claude-sonnet-5-5", "high"]]) {
    const stream = ($ as any).turn.step({ turnId: "t", index: 0, model, effort, agentId, messageCount: 2 });
    for await (const _ of stream) {
    }
    await ($ as any).turn.complete({ answer: "ok", agentId } as any);
  }
  // Each request at list prices: fresh input, cache reads, 5-minute cache writes, output at 5× input.
  const cost = (p: { input: number; read: number }) => (2_000 * p.input + 70_000 * p.read + 6_000 * 1.25 * p.input + 20_000 * 5 * p.input) / 1e6;
  const haiku = 2 * cost(PRICE["claude-haiku-5-5"]);
  const sonnet = cost(PRICE["claude-sonnet-5-5"]);
  const saved = 3 * cost(PRICE["claude-opus-5-5"]) - haiku - sonnet;
  const { ui, texts } = await band($, "desktop");
  expect(texts).toContain("3");
  expect(await cardOf(ui, "agents")).toBe(
    [
      "Agents in this thread: 3",
      `Opus 5.5 · main thread: ≈ ${en$(10 - haiku - sonnet)} · 98%`,
      `Sonnet 5.5 · 1 agent: ≈ ${en$(sonnet)} · 2%`,
      "  effort high ×1 · 98k tokens",
      `Haiku 5.5 · 2 agents: ≈ ${en$(haiku)} · < 1%`,
      "  effort medium ×1 · high ×1 · 196k tokens",
      `Delegating: ≈ ${en$(saved)} saved compared with Opus 5.5.`,
    ].join("\n"),
  );
  // The detail lines are dim.
  const detail: any = await ui.find({ type: "Text", text: "  effort high ×1 · 98k tokens" });
  expect(detail?.props?.dimColor).toBe(true);
  // Kept in the store: a resumed thread finds its agents again.
  await $.session.start({ source: "resume", cwd: "/tmp" } as any);
  expect(String(await cardOf((await band($, "desktop")).ui, "agents"))).toContain("Haiku 5.5 · 2 agents");
});

test("desktop icons: gauge centred at y=12", async ($, on) => {
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
  expect(source("5-hour limit")).toContain('<g transform="translate(0 0.5)"><path d="M3.6 18.5');
});

test("cache expired from 300k: what gets written again, and a new thread", async ($, on) => {
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
  // A new thread avoids rewriting the whole context; a compaction would read it all again.
  // The terminal has no tooltip: the advice stays on the line.
  expect(texts).toContain(`· 741k to rewrite ≈ ${en$(rewriteCost(741_000))} · new thread`);
  expect(texts.join(" ")).not.toContain("/compact");
  // In the app the advice moves to the bolt's tooltip.
  const desktop = await band($, "desktop");
  expect(desktop.texts).toContain(`741k to rewrite ≈ ${en$(rewriteCost(741_000))}`);
  expect(desktop.texts.join(" ")).not.toContain("new thread");
  const tip = String(await boltTip(desktop.ui));
  expect(tip).toContain(`The next message writes the whole context (741k) again at full price, ≈ ${en$(rewriteCost(741_000))}.`);
  expect(tip).toContain("A new thread avoids this rewrite; a compaction would read it all again.");
  expect(tip).not.toContain("/compact");
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

test("desktop: pills never shrink, and the 5-hour reset time sits in the pill's hover card", async ($, on) => {
  world(on);
  withUsage(on, LIMITS);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const { ui } = await band($, "desktop");
  const pills = ((await ui.findAll({ type: "Box" })) as any[]).filter((b) => b.props?.backgroundColor && b.props?.position !== "absolute");
  for (const p of pills) expect(p.props?.flexShrink).toBe(0);
  expect(await cardOf(ui, "gauge-5h")).toBe(`Resets at ${at(NOW + 3 * 3_600_000)}`);
});

// ---------- Compaction ----------

// A large thread whose cache expired, as the band showed it before a /compact.
async function largeExpired($: any, on: any, compaction: Record<string, unknown>) {
  const clock = mock.clock(on, { now: NOW });
  mock.store(on, {});
  mock.env(on, {});
  on("session.id", () => ({ value: "session-1" }));
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
  on("turn.complete", () => ({ text: "" }));
  on("session.compact", () => compaction);
  withUsage(on, LIMITS, { tokens: 784_000, window: 1_000_000, percent: 78 });
  engineStep(on, [
    { ...HIT, cache_read_input_tokens: 780_000 },
    // The first request after the compaction writes the whole, smaller, context.
    { ...MISS, cache_creation_input_tokens: 47_700 },
  ]);
  await $.session.start({ source: "resume", cwd: "/tmp" } as any);
  await step($, HIT);
  await (clock as any).advance(75 * 60_000);
  return clock;
}

test("compaction: the context drops at once, no expired cache", async ($, on) => {
  await largeExpired($, on, { messages: [{ role: "user", text: "Summary of the thread", toolUses: [] }], tokensBefore: 784_000, tokensAfter: 48_000 });
  const before = await band($, "terminal");
  expect(before.texts).toContain("784k");
  expect(before.texts).toContain("expired");
  expect(before.texts).toContain(`· 784k to rewrite ≈ ${en$(rewriteCost(784_000))} · new thread`);
  await ($ as any).session.compact({ trigger: "manual", messages: [{ role: "user", text: "Go on", toolUses: [] }, { role: "assistant", text: "Done", toolUses: [] }] });
  const after = await band($, "terminal");
  expect(after.texts).toContain("48k");
  expect(after.texts).not.toContain("784k");
  expect(after.texts.join(" ")).not.toContain("new thread");
  expect(after.texts).not.toContain("expired");
  expect(after.texts).toContain("compacted");
  expect(await boltTip((await band($, "desktop")).ui)).toBe("Compacted: the next message writes a new, smaller cache.");
  // The next request writes a new cache: neither a miss nor expired.
  await step($, HIT);
  const next = await band($, "terminal");
  expect(next.texts).not.toContain("compacted");
  expect(next.texts.join(" ")).not.toContain("missed");
  expect(next.texts).toContain("1h00");
});

test("compaction: a skipped one changes nothing", async ($, on) => {
  await largeExpired($, on, { skip: "blocked by a hook" });
  await ($ as any).session.compact({ trigger: "manual", messages: [{ role: "user", text: "Go on", toolUses: [] }, { role: "assistant", text: "Done", toolUses: [] }] });
  const { texts } = await band($, "terminal");
  expect(texts).toContain("784k");
  expect(texts).toContain("expired");
  expect(texts).not.toContain("compacted");
});

// ---------- Cache prices ----------

// A large thread: 289k of context, 287k of it read from the cache by the last message.
const BIG = { tokens: 289_000, window: 1_000_000, percent: 29 };
const BIG_HIT = { model: "claude-opus-5-5", input_tokens: 300, cache_read_input_tokens: 287_000, cache_creation_input_tokens: 1_700, output_tokens: 500 };

// Model ids as providers spell them, and the list price each one should find.
for (const [model, family] of [
  ["claude-opus-5-5", "claude-opus-5-5"],
  ["claude-opus-5-5[1m]", "claude-opus-5-5"],
  ["us.anthropic.claude-sonnet-5-5", "claude-sonnet-5-5"],
  ["claude-haiku-4-5-20251001", "claude-haiku-4-5"],
  ["claude-unknown-9", null],
] as const) {
  test(`cache price of ${model}`, async ($, on) => {
    world(on);
    withUsage(on, LIMITS, BIG);
    engineStep(on, [{ ...BIG_HIT, model }]);
    await $.session.start({ source: "startup", cwd: "/tmp" } as any);
    await step($, { ...BIG_HIT, model }, model);
    const tip = String(await boltTip((await band($, "desktop")).ui));
    if (family) {
      expect(tip).toContain(`Reading the context: ≈ ${en$(readCost(289_000, family))} a message. If it expires: ≈ ${en$(rewriteCost(289_000, family))} to write it again.`);
    } else {
      // Unknown: tokens only, no price anywhere.
      expect(tip).toContain("Last message: 99% read from the cache (287k).");
      expect(tip).not.toContain("$");
    }
  });
}

test("cache tooltip, warm, French: lifetime observed, costs, savings", async ($, on) => {
  const clock = world(on, { LANG: "fr_FR.UTF-8" });
  withUsage(on, LIMITS, BIG);
  engineStep(on, [BIG_HIT, BIG_HIT]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await step($, BIG_HIT);
  // A hit 6 minutes later proves the 1-hour lifetime.
  await clock.advance(6 * 60_000);
  await step($, BIG_HIT);
  const { ui, texts } = await band($, "desktop");
  // The pill itself is unchanged: the time left alone.
  expect(texts).toContain("1h00");
  expect(texts.join(" ")).not.toContain("$");
  expect(await boltTip(ui)).toBe(
    [
      `Cache chaud jusqu'à ${at(NOW + 6 * 60_000 + 3_600_000)} (durée 1 h constatée).`,
      // 287k read out of a 289.3k prompt.
      "Dernier message : 99 % lu depuis le cache (287k).",
      `Relire le contexte : ≈ ${fr$(readCost(289_000))} par message. S'il expire : ≈ ${fr$(rewriteCost(289_000))} pour le réécrire.`,
      // Two hits of 287k each, at the input price minus the cache-read price.
      `Ce fil : ≈ ${fr$(2 * savedBy(287_000))} économisés grâce au cache.`,
    ].join("\n"),
  );
});

test("cache tooltip, warm, English: lifetime assumed", async ($, on) => {
  world(on);
  withUsage(on, LIMITS, BIG);
  engineStep(on, [BIG_HIT]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await step($, BIG_HIT);
  await step($, BIG_HIT);
  expect(await boltTip((await band($, "desktop")).ui)).toBe(
    [
      `Cache warm until ${at(NOW + 3_600_000)} (1-hour lifetime, assumed).`,
      "Last message: 99% read from the cache (287k).",
      `Reading the context: ≈ ${en$(readCost(289_000))} a message. If it expires: ≈ ${en$(rewriteCost(289_000))} to write it again.`,
      `This thread: ≈ ${en$(2 * savedBy(287_000))} saved by the cache.`,
    ].join("\n"),
  );
});

test("cache: under 10 minutes and under 90% served, the stake after the time", async ($, on) => {
  const clock = world(on);
  withUsage(on, LIMITS);
  const PART = { ...HIT, cache_read_input_tokens: 72_000, cache_creation_input_tokens: 0, input_tokens: 28_000 };
  engineStep(on, [PART]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await step($, PART);
  await clock.advance(55 * 60_000);
  const { ui, texts } = await band($, "terminal");
  expect(texts).toContain("72%");
  const time: any = await ui.find({ type: "Text", text: "· 5 min" });
  expect(time?.props?.color).toBe("#a8690a");
  expect(texts).toContain(`· ${en$(rewriteCost(107_000))} at stake`);
  expect(texts.indexOf("· 5 min")).toBeLessThan(texts.indexOf(`· ${en$(rewriteCost(107_000))} at stake`));
});

test("cache expired at 150k: the price in the pill, /compact in the tooltip", async ($, on) => {
  const clock = world(on);
  withUsage(on, LIMITS, { tokens: 150_000, window: 1_000_000, percent: 15 });
  engineStep(on, [HIT]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await step($, HIT);
  await clock.advance(61 * 60_000);
  const desktop = await band($, "desktop");
  expect(desktop.texts).toContain(`150k to rewrite ≈ ${en$(rewriteCost(150_000))}`);
  expect(desktop.texts.join(" ")).not.toContain("/compact");
  expect(await boltTip(desktop.ui)).toBe(
    `The next message writes the whole context (150k) again at full price, ≈ ${en$(rewriteCost(150_000))}.\n/compact before going on: the context written again will be smaller.`,
  );
  // The terminal, without a tooltip, keeps the advice on the line.
  const { texts } = await band($, "terminal");
  expect(texts).toContain(`· 150k to rewrite ≈ ${en$(rewriteCost(150_000))} · /compact`);
});

test("cache: an unknown model shows tokens, never dollars", async ($, on) => {
  const clock = world(on);
  withUsage(on, LIMITS);
  const OTHER = { ...HIT, model: "claude-unknown-9" };
  engineStep(on, [OTHER]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await step($, OTHER, "claude-unknown-9");
  await clock.advance(55 * 60_000);
  let desktop = await band($, "desktop");
  expect(desktop.texts).toContain("107k at stake");
  expect(desktop.texts.join(" ")).not.toContain("$");
  expect(await boltTip(desktop.ui)).toBe(`The cache expires at ${at(NOW + 3_600_000)}. Send your next message before then, or it writes 107k tokens again.`);
  await clock.advance(6 * 60_000);
  desktop = await band($, "desktop");
  expect(desktop.texts).toContain("107k to rewrite");
  expect(desktop.texts.join(" ")).not.toContain("$");
  expect(String(await boltTip(desktop.ui))).not.toContain("$");
  const { texts } = await band($, "terminal");
  expect(texts).toContain("· 107k to rewrite · /compact");
});

test("cache savings: kept in the store, back on a resumed session", async ($, on) => {
  mock.clock(on, { now: NOW });
  mock.env(on, {});
  const store = new Map<string, unknown>();
  on("store.get", (_$: any, e: any) => ({ value: store.get(e.key) }));
  on("store.set", (_$: any, e: any) => (store.set(e.key, e.value), { value: undefined }));
  on("store.delete", (_$: any, e: any) => (store.delete(e.key), { value: undefined }));
  on("store.keys", () => ({ value: [...store.keys()] }));
  on("session.id", () => ({ value: "session-1" }));
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
  on("turn.complete", () => ({ text: "" }));
  withUsage(on, LIMITS, BIG);
  engineStep(on, [BIG_HIT]);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await step($, BIG_HIT);
  await step($, BIG_HIT);
  await ($ as any).turn.complete({ answer: "ok" } as any);
  const saved = (store.get("turns:session-1") as any)?.saved;
  expect(Math.abs(saved - 2 * savedBy(287_000))).toBeLessThan(1e-9);
  // Restarted: the figure comes back from the store, not from new requests.
  await $.session.start({ source: "resume", cwd: "/tmp" } as any);
  expect(String(await boltTip((await band($, "desktop")).ui))).toContain(`This thread: ≈ ${en$(2 * savedBy(287_000))} saved by the cache.`);
});
