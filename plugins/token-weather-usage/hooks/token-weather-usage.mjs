// Token Weather Usage: one line above the prompt.
//   Terminal, blocks split by a thin rule:
//   ☁ 440k ▃▆▂█▃▄▂▇ ▲ +8.4k │ 5h ━━━╍╍╍── 37% · 2h22 → 18:20 │ 7d ━━━━╍─── 60% · 2d23h │ cache 98% · 52 min │ ≈ $4.32 (+$0.84) │ 2 agents
//   Desktop app: the same blocks as tinted, outlined pills.
//
// Weather, context and recent turns: adapted from the Token Weather example,
//   Copyright 2026 Anthropic PBC, SPDX-License-Identifier: Apache-2.0 (claude-code-playground).
// 5-hour and 7-day limits: written for this mod after HolyGrail's usage-meter
//   (https://github.com/HolyGrail/claude-mods/tree/main/plugins/usage-meter), without copying its code.
// Prompt cache: written for this mod after Daniel San's prompt-cache-control
//   (https://github.com/davila7/claude-code-templates, MIT), without copying its code.
//
// The engine reads on(...) and $.noun.method(...) from the source: they stay spelled out,
// and the functions that take $ live at the top level.

// ---------- Language ----------

// Labels in English or French. "auto" follows LC_ALL, LC_MESSAGES or LANG, then the runtime's
// locale; English unless one of them starts with "fr". The desktop app often sets none of
// them, so the language option (/config) is the sure way to pick.
const TEXT = {
  en: {
    weather: { clear: "Clear", cloudy: "Cloudy", showers: "Showers", storm: "Storm", compact: "Compact soon" },
    percent: (n) => `${n}%`,
    labels: { five_hour: "5h", seven_day: "7d", spend_limit: "$" },
    day: "d",
    contextAlt: (word, percent, window) => `${word} · ${percent} of ${window}`,
    turnsAlt: (n) => `Tokens added by the last ${n} prompts`,
    gaugeAlt: (label, value) => `${label}: ${value} used`,
    cache: "cache",
    expired: "expired",
    missed: "missed",
    causes: { model: "model changed", lapsed: "lapsed", prefix: "start changed" },
    underMinute: "< 1 min",
    cost: (usd) => `≈ $${usd.toFixed(2)}`,
    lastPrompt: (usd) => `+$${usd.toFixed(2)}`,
    agents: (n) => (n === 1 ? "1 agent" : `${n} agents`),
    icons: { five_hour: "5-hour limit", seven_day: "7-day limit", spend_limit: "Spend limit", reset: "Resets in", cache: "Prompt cache", cost: "Session cost", lastPrompt: "Last prompt", agents: "Agents running" },
  },
  fr: {
    weather: { clear: "Clair", cloudy: "Nuageux", showers: "Averses", storm: "Orage", compact: "Compacter bientôt" },
    percent: (n) => `${n} %`,
    labels: { five_hour: "5h", seven_day: "7j", spend_limit: "$" },
    day: "j",
    contextAlt: (word, percent, window) => `${word} · ${percent} de ${window}`,
    turnsAlt: (n) => `Tokens ajoutés par les ${n} derniers prompts`,
    gaugeAlt: (label, value) => `${label} : ${value} consommés`,
    cache: "cache",
    expired: "expiré",
    missed: "raté",
    causes: { model: "modèle changé", lapsed: "délai dépassé", prefix: "début modifié" },
    underMinute: "< 1 min",
    cost: (usd) => `≈ ${usd.toFixed(2).replace(".", ",")} $`,
    lastPrompt: (usd) => `+${usd.toFixed(2).replace(".", ",")} $`,
    agents: (n) => (n === 1 ? "1 agent" : `${n} agents`),
    icons: { five_hour: "Limite 5 h", seven_day: "Limite 7 jours", spend_limit: "Plafond de dépense", reset: "Remise à zéro dans", cache: "Cache de prompt", cost: "Coût du fil", lastPrompt: "Dernier prompt", agents: "Agents en cours" },
  },
};
let T = TEXT.en;

// ---------- Context weather (Token Weather) ----------

const HISTORY = 12;
const BARS = "▁▂▃▄▅▆▇█";
const FORECAST = [
  // Single-column symbols, no emoji: they line up in every font.
  { upTo: 25, id: "clear", icon: "☀", color: "yellow" },
  { upTo: 50, id: "cloudy", icon: "☁", color: "cyan" },
  { upTo: 75, id: "showers", icon: "☂", color: "blue" },
  { upTo: 90, id: "storm", icon: "☇", color: "magenta" },
  { upTo: Infinity, id: "compact", icon: "↯", color: "red" },
];

// Turn bars: tokens added by each recent prompt; the current prompt takes the weather's tint
// (colors readable on light and dark backgrounds), earlier ones stay grey.
const TURN_BARS = 8;
const SPARK = { height: 14, bar: 5.5, gap: 2 };
const PAST_BAR = "rgba(127,127,127,0.45)";
const SPARK_COLORS = { yellow: "#e0b000", cyan: "#1ba1c4", blue: "#2f68c0", magenta: "#b04fc0", red: "#d64545" };

// Weather icons drawn in the app (the terminal keeps FORECAST's Unicode symbols): filled,
// 15 px, each in its own tint. "Compact soon" redraws the ↯ zigzag with a thick stroke.
const WEATHER_ICON_SIZE = 15;
const WEATHER_ICONS = {
  clear: (c) =>
    `<circle cx="12" cy="12" r="4.5" fill="${c}"/><path fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`,
  cloudy: (c) =>
    `<path fill="${c}" stroke="${c}" stroke-width="1.5" stroke-linejoin="round" d="M7 18.5a3.75 3.75 0 0 1-.4-7.48A5.6 5.6 0 0 1 17.2 9.6a4.45 4.45 0 0 1 .3 8.9z"/>`,
  showers: (c) =>
    `<path fill="${c}" stroke="${c}" stroke-width="1.5" stroke-linejoin="round" d="M7 14.5a3.25 3.25 0 0 1-.35-6.48A5 5 0 0 1 16.2 6.8a3.85 3.85 0 0 1 .3 7.7z"/><path fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>`,
  storm: (c) => `<path fill="${c}" stroke="${c}" stroke-width="1.5" stroke-linejoin="round" d="M13.5 2 5 13.5h6.5L10.5 22 19 10.5h-6.5z"/>`,
  compact: (c) =>
    `<path fill="none" stroke="${c}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" d="M14 2 7 12h8l-5 9M14.5 18.8 10 21l-.5-5"/>`,
};
const WEATHER_ICON_COLORS = { clear: "#e0b000", cloudy: "#8ea3b8", showers: "#2f68c0", storm: "#b04fc0", compact: "#d64545" };

// An interactive Svg (for its tooltip) is drawn in a frame of its own: without a color scheme
// matching the app's, the browser paints that frame white in dark mode.
const FRAME_SCHEME = "<style>:root{color-scheme:light dark}</style>";

// The weather word lives in the icon's tooltip: the pill keeps the tokens alone.
function weatherSvg(id, title) {
  const draw = WEATHER_ICONS[id];
  if (!draw) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WEATHER_ICON_SIZE}" height="${WEATHER_ICON_SIZE}" viewBox="0 0 24 24">${FRAME_SCHEME}<title>${escapeXml(title)}</title>${draw(WEATHER_ICON_COLORS[id])}</svg>`;
}

// Context readings: { tokens, window, percent }, oldest first.
let readings = [];
// Each session's readings are kept in $.store, so the bars come back after a restart.
const TURNS_PREFIX = "turns:";
const TURNS_KEEP_MS = 8 * 24 * 3_600_000;
let turnsKey = null;

// ---------- Account limits ----------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Length of each window; without one (spend cap), no elapsed-time marker.
const SPANS = { five_hour: 5 * HOUR, seven_day: 7 * DAY };
// Display order; an unknown window goes last.
const ORDER = ["five_hour", "seven_day", "spend_limit"];
// Pace = share used minus share of time elapsed, in points.
// Above 0: using faster than time; beyond 15, or at 90% used: alert.
const PACE_ALERT = 15;
const USED_ALERT = 90;
// Limits belong to the account: the latest reading, across sessions, lives in $.store.
const SHARED_KEY = "limits";

// Latest known reading: { at (ms), list: SessionRateLimit[] }.
let limits = { at: 0, list: [] };
let ticker = null;

// ---------- Prompt cache ----------

// The cache keeps the start of the conversation for 5 minutes, or 1 hour; each request that
// reads it starts the time again, counted from the request's start. Once it lapses, the next
// message writes the whole context again. Mods get the token counts, not the lifetime: it is
// inferred (Claude Code's rules, then what the traffic shows).
const TTL = { "5m": 5 * MINUTE, "1h": HOUR };
// Yellow under 10 minutes left.
const CACHE_SOON = 10 * MINUTE;
// From this context size, an expired cache suggests /compact before going on.
const COMPACT_AT = 100_000;
// A request that read less than half its prompt from the cache, and wrote more than this, missed.
const MISS_SHARE = 50;
const MISS_WRITE = 1_000;
// Last main-loop request: { at, model, read, write, fresh, cause }.
let cache = null;
// Lifetime seen in the traffic ("5m" | "1h"), which beats the rules.
let seenTtl = null;
// Environment switches read at session start.
let cacheEnv = {};
let cacheTicker = null;
let cacheKey = "";

// Session cost in dollars, as /cost totals it; null where the host keeps no ledger.
let cost = null;
// What the last prompt added to it (its subagents included), and the total it started from.
let lastPrompt = null;
let promptBase = null;

// Subagents running now: { id, description, type }.
let agents = [];
let agentsKey = "";

// ---------- Layout ----------

const SEP = "│";
const TEXT_CELLS = 8;
const GAUGE = { width: 72, height: 9 };
const TONES = {
  calm: { svg: "#3fa66b", text: "green" },
  fast: { svg: "#d9962b", text: "yellow" },
  alert: { svg: "#d64545", text: "red" },
};
const TRACK = "rgba(127,127,127,0.2)";
// Hatching of the gap when using slower than time: grey stripes on the gauge's track.
const HATCH = { back: "rgba(127,127,127,0.16)", line: "rgba(127,127,127,0.6)" };
// Desktop pills: a light tint and a slightly stronger outline per block.
const TINTS = {
  context: ["rgba(47,104,192,0.10)", "rgba(47,104,192,0.28)"],
  five_hour: ["rgba(63,166,107,0.13)", "rgba(63,166,107,0.32)"],
  seven_day: ["rgba(140,100,210,0.13)", "rgba(140,100,210,0.32)"],
  spend_limit: ["rgba(184,140,40,0.13)", "rgba(184,140,40,0.34)"],
  calm: ["rgba(27,161,196,0.11)", "rgba(27,161,196,0.30)"],
  fast: ["rgba(217,150,43,0.14)", "rgba(217,150,43,0.36)"],
  alert: ["rgba(214,69,69,0.12)", "rgba(214,69,69,0.36)"],
  cost: ["rgba(184,140,40,0.13)", "rgba(184,140,40,0.34)"],
  agents: ["rgba(196,80,127,0.11)", "rgba(196,80,127,0.32)"],
};
// Small outlined icons in the app, each in its pill's color (the alt text is required: a
// drawing without one is dropped). The clock before a reset time takes the pill's color too.
const ICON_SIZE = 16;
const SMALL_ICON = 14;
const ICONS = {
  gauge: (c) =>
    `<path d="M3.6 18.5a9.5 9.5 0 1 1 16.8 0" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/><path d="M12 14.5l4.3-4.6" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="14.5" r="1.7" fill="${c}"/>`,
  calendar: (c) =>
    `<rect x="3" y="4.5" width="18" height="17" rx="3" fill="none" stroke="${c}" stroke-width="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/><text x="12" y="19.2" font-size="8.5" font-weight="700" font-family="-apple-system,Helvetica,Arial,sans-serif" text-anchor="middle" fill="${c}">7</text>`,
  // A clock turning back: the time left before the window starts over.
  clock: (c) =>
    `<path d="M4.2 13A8 8 0 1 0 6.6 6.2" fill="none" stroke="${c}" stroke-width="2.1" stroke-linecap="round"/><path d="M3.4 3.6v4.2h4.2" fill="none" stroke="${c}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8v4.6l3 1.8" fill="none" stroke="${c}" stroke-width="2.1" stroke-linecap="round"/>`,
  bolt: (c) => `<path d="M13.2 2 4 13.6h7.2L10.4 22l9.2-11.6h-7.2z" fill="${c}" fill-opacity="0.18" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`,
  coin: (c) =>
    `<circle cx="12" cy="12" r="9.5" fill="${c}" fill-opacity="0.16" stroke="${c}" stroke-width="2"/><path d="M15 8.8c-.5-1-1.6-1.6-3-1.6-1.7 0-3 .9-3 2.2s1.3 1.8 3 2.1 3 .9 3 2.2-1.3 2.3-3 2.3c-1.4 0-2.5-.6-3.1-1.6M12 5.6v1.6M12 16.8v1.6" fill="none" stroke="${c}" stroke-width="1.9" stroke-linecap="round"/>`,
  // A speech bubble: what the last prompt cost.
  prompt: (c) =>
    `<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z" fill="${c}" fill-opacity="0.14" stroke="${c}" stroke-width="2" stroke-linejoin="round"/><path d="M8.5 8.5h7M8.5 11.5h4.5" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
  // A small robot: subagents at work.
  agents: (c) =>
    `<rect x="4" y="7.5" width="16" height="12.5" rx="3.5" fill="${c}" fill-opacity="0.14" stroke="${c}" stroke-width="2"/><path d="M12 7.5V4M2 12.5v3M22 12.5v3" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="3.2" r="1.3" fill="${c}"/><circle cx="9" cy="13" r="1.5" fill="${c}"/><circle cx="15" cy="13" r="1.5" fill="${c}"/><path d="M9.5 16.8h5" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round"/>`,
};
// Icon color per block: deeper than the pill's tint, readable on light and dark backgrounds.
const ICON_COLORS = { five_hour: "#3a9a62", seven_day: "#8a5fd0", spend_limit: "#b8892a", calm: "#1b9cbe", fast: "#d9962b", alert: "#d64545", cost: "#b8892a", agents: "#c4507f" };
const LIMIT_ICONS = { five_hour: "gauge", seven_day: "calendar", spend_limit: "coin" };
// Columns the terminal may cover at the end of the band.
const RESERVED_COLUMNS = 2;

export function register(on, options) {
  const language = options?.language;

  on("session.start", async ($, e, next) => {
    ticker?.cancel();
    cacheTicker?.cancel();
    T = TEXT[await languageOf($, language)];
    readings = [];
    limits = { at: 0, list: [] };
    cache = null;
    seenTtl = null;
    lastPrompt = null;
    cacheKey = "";
    cacheEnv = await cacheEnvOf($);
    turnsKey = TURNS_PREFIX + (await $.session.id());
    await restoreTurns($);
    const usage = await $.session.usage();
    pushReading(usage.context);
    cost = usage.cost?.usd ?? null;
    promptBase = cost;
    agents = [];
    agentsKey = "";
    await refreshAgents($);
    // On start or reload the local reading may be stale (an idle session): the shared reading
    // wins, and the local one is published only when none exists yet.
    await adoptShared($);
    if (limits.list.length === 0 && usage.rateLimits.length > 0) await shareLimits($, usage.rateLimits);
    // Every minute: elapsed time moves on, and another session may have measured something newer.
    ticker = $.clock.every(MINUTE, async () => {
      await adoptShared($);
      $.ui.invalidate("ui.render");
    });
    // The cache countdown: a redraw only when its text changes.
    // and the agents running, which start and end between turns.
    cacheTicker = $.clock.every(10_000, async () => {
      const key = cacheText(cacheState(await $.clock.now()));
      const changed = await refreshAgents($);
      if (key !== cacheKey || changed) {
        cacheKey = key;
        $.ui.invalidate("ui.render");
      }
    });
    $.ui.invalidate("ui.render");
    return next(e);
  });

  on("session.end", async ($, e, next) => {
    // A real end (exit, or process stopped); /clear, /resume and disconnect keep the tickers.
    if (e.reason === "prompt_input_exit" || e.reason === "other") {
      ticker?.cancel();
      cacheTicker?.cancel();
    }
    return next(e);
  });

  // Each main-loop request: how much of its prompt the cache served (subagents have their own).
  on("turn.step", async function* ($, e, next) {
    if (e.agentId) return yield* next(e);
    const at = await $.clock.now();
    const result = yield* next(e);
    if (result?.usage) {
      recordRequest(at, result.usage);
      // The request may have started an agent.
      await refreshAgents($);
      $.ui.invalidate("ui.render");
    }
    return result;
  });

  // One context reading after each main turn (not subagents' turns).
  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    // A subagent's turn: it may have just finished.
    if (e.agentId) {
      if (await refreshAgents($)) $.ui.invalidate("ui.render");
      return result;
    }
    try {
      const usage = await $.session.usage();
      pushReading(usage.context);
      if (usage.cost) {
        cost = usage.cost.usd;
        if (promptBase !== null && cost >= promptBase) lastPrompt = cost - promptBase;
        promptBase = cost;
      }
      await saveTurns($);
      $.ui.invalidate("ui.render");
    } catch {
      // No reading this turn: the line keeps the previous one.
    }
    return result;
  });

  on("session.measure", async ($, e, next) => {
    if (e.changed.includes("rateLimits") && e.rateLimits.length > 0) await shareLimits($, e.rateLimits);
    if (e.cost) cost = e.cost.usd;
    $.ui.invalidate("ui.render");
    return next(e);
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const props = e.props ?? e;
    if (props.hasSurvey || (readings.length === 0 && limits.list.length === 0)) return next(e);
    const elements = $.ui.resolve(e);
    const now = await $.clock.now();
    const line = drawLine(elements, e.surface, props.bodyColumns ?? 80, now);
    // Mods placed after us draw below our line; an empty drawing adds no blank line.
    const below = await next(e);
    return isBlank(below) ? line : elements.Box({ flexDirection: "column", children: [line, below] });
  });
}

// "en" or "fr": the language option when it names one, otherwise the environment's locale.
async function languageOf($, choice) {
  if (choice === "en" || choice === "fr") return choice;
  let locale = "";
  try {
    locale = (await $.env.get("LC_ALL")) || (await $.env.get("LC_MESSAGES")) || (await $.env.get("LANG")) || "";
  } catch {
    locale = "";
  }
  if (!locale || locale === "C" || locale === "POSIX") {
    try {
      locale = Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
      locale = "";
    }
  }
  return /^fr/i.test(locale) ? "fr" : "en";
}

// ---------- Turns: readings kept per session ----------

// Restores this session's readings and cache, and deletes sessions idle for more than 8 days.
async function restoreTurns($) {
  const now = await $.clock.now();
  try {
    for (const key of await $.store.keys()) {
      if (!key.startsWith(TURNS_PREFIX)) continue;
      const saved = await $.store.get(key);
      if (key === turnsKey && saved && Array.isArray(saved.readings)) {
        readings = saved.readings.filter((r) => r && r.window > 0).slice(-HISTORY);
        if (saved.cache && Number.isFinite(saved.cache.at)) cache = saved.cache;
        if (saved.seenTtl === "5m" || saved.seenTtl === "1h") seenTtl = saved.seenTtl;
        if (Number.isFinite(saved.lastPrompt)) lastPrompt = saved.lastPrompt;
      } else if (!saved || !(now - saved.at < TURNS_KEEP_MS)) await $.store.delete(key);
    }
  } catch {
    // Unreadable store: the line starts from scratch.
  }
}

async function saveTurns($) {
  if (!turnsKey) return;
  try {
    await $.store.set(turnsKey, { at: await $.clock.now(), readings, cache, seenTtl, lastPrompt });
  } catch {
    // Not saved this turn: the bars come back on the next one.
  }
}

// ---------- Limits: shared reading ----------

// Keeps this session's reading and publishes it if it is the most recent known.
async function shareLimits($, list) {
  const at = await $.clock.now();
  limits = { at, list: sortLimits(list) };
  let stored = null;
  try {
    stored = await $.store.get(SHARED_KEY);
  } catch {
    stored = null;
  }
  if (!stored || !(stored.at > at)) await $.store.set(SHARED_KEY, limits);
}

// Takes another session's reading when it is newer than ours.
async function adoptShared($) {
  try {
    const stored = await $.store.get(SHARED_KEY);
    if (stored && Array.isArray(stored.list) && stored.at > limits.at) limits = { at: stored.at, list: sortLimits(stored.list) };
  } catch {
    // Unreadable store: keep the local reading.
  }
}

function sortLimits(list) {
  const rank = (kind) => (ORDER.includes(kind) ? ORDER.indexOf(kind) : ORDER.length);
  return [...list].sort((a, b) => rank(a.kind) - rank(b.kind));
}

// ---------- Limits: reading one window ----------

// What the line shows of a window: share used, time elapsed, tone, grey detail.
function gaugeOf(limit, now) {
  const used = Math.max(0, limit.percentUsed);
  const resetMs = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN;
  const span = SPANS[limit.kind];
  const left = Number.isFinite(resetMs) ? Math.max(0, resetMs - now) : null;
  const elapsed = span && left !== null ? bound(((span - left) / span) * 100) : null;
  const pace = elapsed === null ? 0 : used - elapsed;
  const tone = used >= USED_ALERT || pace > PACE_ALERT ? "alert" : pace > 0 ? "fast" : "calm";
  let when = "";
  if (left !== null) when = limit.kind === "five_hour" ? `${duration(left)} → ${clockTime(resetMs)}` : duration(left);
  return { kind: limit.kind, label: T.labels[limit.kind] ?? limit.kind, used, elapsed, tone, value: T.percent(Math.round(used)), when };
}

// 3h02, 42 min, 2d23h (2j23h in French).
function duration(ms) {
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${minutes} min`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}${T.day}${String(hours).padStart(2, "0")}h`;
  return `${hours}h${String(minutes % 60).padStart(2, "0")}`;
}

// 24-hour time in the machine's time zone; UTC when the runtime has no time zone data.
function clockTime(ms) {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
  } catch {
    const d = new Date(ms);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
  }
}

function bound(percent) {
  return Math.min(100, Math.max(0, percent));
}

// ---------- Prompt cache: requests and lifetime ----------

// Names stay literal: the engine lists the variables a module reads.
async function cacheEnvOf($) {
  const read = async (get) => {
    try {
      return (await get()) || "";
    } catch {
      return "";
    }
  };
  return {
    off: isOn(await read(() => $.env.get("DISABLE_PROMPT_CACHING"))),
    force5m: isOn(await read(() => $.env.get("FORCE_PROMPT_CACHING_5M"))),
    ttl: await read(() => $.env.get("CLAUDE_CODE_PROMPT_CACHE_TTL")),
    enable1h: isOn(await read(() => $.env.get("ENABLE_PROMPT_CACHING_1H"))),
  };
}

function isOn(value) {
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function promptOf(r) {
  return (r.read ?? 0) + (r.write ?? 0) + (r.fresh ?? 0);
}

function hitOf(r) {
  const total = promptOf(r);
  return total > 0 ? Math.round(((r.read ?? 0) / total) * 100) : 0;
}

// Notes a main-loop request, names the cause when it missed the cache, and learns the lifetime.
function recordRequest(at, usage) {
  const cur = {
    at,
    model: usage.model ?? "",
    read: usage.cache_read_input_tokens ?? 0,
    write: usage.cache_creation_input_tokens ?? 0,
    fresh: usage.input_tokens ?? 0,
    cause: null,
  };
  const prev = cache;
  if (prev) {
    const gap = at - prev.at;
    const missed = hitOf(cur) < MISS_SHARE && cur.write > MISS_WRITE;
    // A hit more than 5 minutes after the previous request proves the 1-hour lifetime;
    // a miss within the hour, same model, prompt not shrunk, says 5 minutes.
    if (!missed && cur.read > 0 && gap > TTL["5m"]) seenTtl = "1h";
    else if (missed && gap > TTL["5m"] && gap < TTL["1h"] && cur.model === prev.model && promptOf(cur) >= promptOf(prev)) seenTtl = "5m";
    if (missed) cur.cause = cur.model !== prev.model ? "model" : gap >= ttlMs() ? "lapsed" : "prefix";
  }
  cache = cur;
}

// Claude Code's rules for the main conversation, after what the traffic showed.
function ttlMs() {
  if (seenTtl) return TTL[seenTtl];
  if (cacheEnv.force5m) return TTL["5m"];
  if (cacheEnv.ttl === "5m" || cacheEnv.ttl === "1h") return TTL[cacheEnv.ttl];
  if (cacheEnv.enable1h) return TTL["1h"];
  // A Claude subscription within its plan usage gets 1 hour; usage credits or an API key, 5 minutes.
  const plan = limits.list.filter((l) => l.kind === "five_hour" || l.kind === "seven_day");
  return plan.length > 0 && plan.every((l) => l.percentUsed < 100) ? TTL["1h"] : TTL["5m"];
}

// What the cache block shows: { tone, value, detail, urgent }; null when caching is off.
function cacheState(now) {
  if (cacheEnv.off) return null;
  if (!cache) return { tone: "none", value: "—", detail: "" };
  const left = cache.at + ttlMs() - now;
  const tokens = readings.length > 0 ? readings[readings.length - 1].tokens : promptOf(cache);
  if (left <= 0) return { tone: "alert", value: T.expired, detail: tokens >= COMPACT_AT ? "/compact" : "" };
  const value = T.percent(hitOf(cache));
  if (cache.cause) return { tone: "fast", value, detail: `${T.missed} · ${T.causes[cache.cause]}` };
  const time = left < MINUTE ? T.underMinute : duration(left);
  return left < CACHE_SOON ? { tone: "fast", value, detail: time, urgent: true } : { tone: "calm", value, detail: time };
}

// ---------- Agents ----------

// Reads the subagents running now; true when the list changed.
async function refreshAgents($) {
  let list = [];
  try {
    list = await $.agent.list();
  } catch {
    return false;
  }
  const running = (list ?? []).filter((a) => a && a.status === "running").map((a) => ({ id: a.id, type: a.type ?? "", description: a.description ?? "" }));
  const key = running.map((a) => a.id).join(",");
  if (key === agentsKey) return false;
  agentsKey = key;
  agents = running;
  return true;
}

function cacheText(state) {
  return state ? `${T.cache} ${state.value}${state.detail ? ` · ${state.detail}` : ""}` : "";
}

// ---------- Blocks ----------

function icon(Svg, key, name, color, alt, size = ICON_SIZE) {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${ICONS[name](color)}</svg>`;
  return Svg({ key, source, alt, width: size, height: size });
}

function divider(Text, key) {
  return Text({ key, dimColor: true, children: SEP });
}

function gaugeBlock({ Box, Text, Svg }, mode, g) {
  // The bar carries the color; the text stays in the theme's color, readable everywhere.
  const color = ICON_COLORS[g.kind] ?? ICON_COLORS.spend_limit;
  const parts = [];
  if (mode === "svg") parts.push(icon(Svg, "k", LIMIT_ICONS[g.kind] ?? "coin", color, T.icons[g.kind] ?? g.label));
  parts.push(Text({ key: "l", children: g.label }));
  if (mode === "svg" && Svg) parts.push(Svg({ key: "g", source: svgGauge(g), alt: T.gaugeAlt(g.label, g.value), width: GAUGE.width, height: GAUGE.height }));
  if (mode === "text") parts.push(textGauge(Box, Text, g));
  parts.push(Text(g.tone === "alert" ? { key: "v", bold: true, color: TONES.alert.text, children: g.value } : { key: "v", bold: true, children: g.value }));
  // Terminal too narrow: the detail goes with the bar, leaving the label and the percentage.
  if (g.when && mode === "svg") parts.push(divider(Text, "s"), icon(Svg, "i", "clock", color, T.icons.reset, SMALL_ICON), Text({ key: "d", dimColor: true, children: g.when }));
  else if (g.when && mode === "text") parts.push(Text({ key: "d", dimColor: true, children: `· ${g.when}` }));
  return { key: "gauge-" + g.label, tint: TINTS[g.kind] ?? TINTS.spend_limit, parts };
}

function cacheBlock({ Text, Svg }, mode, state) {
  const parts = [];
  if (mode === "svg") {
    parts.push(icon(Svg, "i", "bolt", ICON_COLORS[state.tone] ?? ICON_COLORS.calm, T.icons.cache));
  }
  parts.push(Text({ key: "l", children: T.cache }));
  // A miss in yellow, an expired cache in red; while the time runs short, the time carries the color.
  const valueColor = state.tone === "alert" ? TONES.alert.text : state.tone === "fast" && !state.urgent ? TONES.fast.text : undefined;
  parts.push(Text(state.tone === "none" ? { key: "v", dimColor: true, children: state.value } : { key: "v", bold: true, ...(valueColor ? { color: valueColor } : {}), children: state.value }));
  if (state.detail && mode !== "none") {
    if (mode === "svg") parts.push(divider(Text, "s"));
    const text = mode === "svg" ? state.detail : `· ${state.detail}`;
    parts.push(Text(state.urgent ? { key: "d", bold: true, color: TONES.fast.text, children: text } : { key: "d", dimColor: true, children: text }));
  }
  const tint = TINTS[state.tone] ?? TINTS.calm;
  return { key: "cache", tint, parts };
}

// ---------- Limits: gauges ----------

// Character bar: solid up to the share used; the gap with elapsed time in heavy dashes ╍,
// in the bar's color when using faster than time, grey otherwise.
function textGauge(Box, Text, g) {
  const used = Math.round((g.used / 100) * TEXT_CELLS);
  const time = g.elapsed === null ? used : Math.round((g.elapsed / 100) * TEXT_CELLS);
  const color = TONES[g.tone].text;
  const cell = (i) => {
    const key = "c" + i;
    if (i < Math.min(used, time)) return Text({ key, color, children: "━" });
    if (i < used) return Text({ key, color, children: "╍" });
    if (i < time) return Text({ key, dimColor: true, children: "╍" });
    return Text({ key, dimColor: true, children: "─" });
  };
  // Cells side by side, without the block's spacing between them.
  return Box({ key: "bar", flexDirection: "row", children: Array.from({ length: TEXT_CELLS }, (_, i) => cell(i)) });
}

// Drawn gauge: solid bar up to the share used; the gap with elapsed time is hatched,
// grey after the bar (margin left) or in the bar's color (ahead of time).
function svgGauge(g) {
  const { width, height } = GAUGE;
  const radius = height / 2;
  const used = (bound(g.used) / 100) * width;
  const time = g.elapsed === null ? used : (g.elapsed / 100) * width;
  const color = TONES[g.tone].svg;
  const id = "tw" + String(g.label).replace(/[^a-z0-9]/gi, "");
  const stripes = (name, back, backOpacity, line) =>
    `<pattern id="${name}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<rect width="4" height="4" fill="${back}" fill-opacity="${backOpacity}"/><rect width="1.6" height="4" fill="${line}"/></pattern>`;
  const defs =
    `<defs>${stripes(id + "m", HATCH.back, 1, HATCH.line)}${stripes(id + "a", color, 0.35, color)}` +
    `<clipPath id="${id}t"><rect width="${width}" height="${height}" rx="${radius}"/></clipPath>` +
    `<clipPath id="${id}b"><rect width="${used.toFixed(1)}" height="${height}" rx="${radius}"/></clipPath></defs>`;
  let body = `<rect width="${width}" height="${height}" fill="${TRACK}"/>`;
  if (time > used) body += `<rect width="${time.toFixed(1)}" height="${height}" fill="url(#${id}m)"/>`;
  body += `<g clip-path="url(#${id}b)"><rect width="${Math.min(used, time).toFixed(1)}" height="${height}" fill="${color}"/>`;
  if (used > time) body += `<rect x="${time.toFixed(1)}" width="${(used - time).toFixed(1)}" height="${height}" fill="url(#${id}a)"/>`;
  body += `</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defs}<g clip-path="url(#${id}t)">${body}</g></svg>`;
}

// ---------- Line ----------

function drawLine(elements, surface, columns, now) {
  const { Box, Text, Svg } = elements;
  const desktop = surface === "desktop" && !!Svg;
  // A window that already reset has no valid reading: hidden until the next one.
  const gauges = limits.list.filter((limit) => !(Date.parse(limit.resetsAt ?? "") <= now)).map((limit) => gaugeOf(limit, now));
  const cacheNow = cacheState(now);
  // Drawn bars in the app; in the terminal, characters when the line fits, otherwise no bar or detail.
  let mode = "svg";
  if (!desktop) mode = textWidth(gauges, cacheNow) <= columns - RESERVED_COLUMNS ? "text" : "none";

  const blocks = [];
  if (readings.length > 0) {
    const cur = readings[readings.length - 1];
    const f = forecastFor(cur.percent);
    const title = T.contextAlt(T.weather[f.id], T.percent(cur.percent), short(cur.window));
    const icon = desktop
      ? Svg({ key: "icon", source: weatherSvg(f.id, title), alt: title, width: WEATHER_ICON_SIZE, height: WEATHER_ICON_SIZE, isInteractive: true })
      : Text({ key: "icon", color: f.color, bold: true, children: f.icon });
    const parts = [icon, Text({ key: "tokens", bold: true, children: short(cur.tokens) })];
    // A single reading draws no trend: the bars wait for the second turn.
    if (readings.length >= 2) {
      if (desktop) {
        parts.push(divider(Text, "s"));
        parts.push(Svg({ key: "spark", source: barsSvg(SPARK_COLORS[f.color] ?? SPARK_COLORS.blue), alt: T.turnsAlt(turnDeltas().length), width: barsWidth(turnDeltas().length), height: SPARK.height }));
      } else {
        parts.push(Box({ key: "spark", flexDirection: "row", children: chartText(Text, f.color) }));
      }
      const trend = trendWord();
      if (trend) parts.push(Text({ key: "d", dimColor: true, children: trend }));
    }
    blocks.push({ key: "context", tint: TINTS.context, parts });
  }
  for (const g of gauges) blocks.push(gaugeBlock(elements, mode, g));
  if (cacheNow) blocks.push(cacheBlock(elements, mode, cacheNow));
  // The cost goes first when the terminal is short of room.
  if (cost !== null && cost >= 0.005 && mode !== "none") {
    const parts = [Text({ key: "v", bold: true, children: T.cost(cost) })];
    if (desktop) parts.unshift(icon(Svg, "i", "coin", ICON_COLORS.cost, T.icons.cost));
    if (lastPrompt !== null && lastPrompt >= 0.005) {
      if (desktop) parts.push(divider(Text, "s"), icon(Svg, "p", "prompt", ICON_COLORS.cost, T.icons.lastPrompt, SMALL_ICON));
      parts.push(Text({ key: "d", dimColor: true, children: desktop ? T.lastPrompt(lastPrompt) : `(${T.lastPrompt(lastPrompt)})` }));
    }
    blocks.push({ key: "cost", tint: TINTS.cost, parts });
  }
  // Agents last, shown only while some run: the blocks before them stay in place.
  if (agents.length > 0) {
    const parts = [];
    if (desktop) {
      // The tooltip lists what each one is doing.
      const title = agents.map((a) => `${a.type} · ${a.description}`).join("\n");
      const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 24 24">${FRAME_SCHEME}<title>${escapeXml(title)}</title>${ICONS.agents(ICON_COLORS.agents)}</svg>`;
      parts.push(Svg({ key: "i", source, alt: T.icons.agents, width: ICON_SIZE, height: ICON_SIZE, isInteractive: true }));
    }
    parts.push(Text({ key: "v", bold: true, children: T.agents(agents.length) }));
    blocks.push({ key: "agents", tint: TINTS.agents, parts });
  }

  const row = (b) => ({ key: b.key, flexDirection: "row", columnGap: 1, alignItems: "center", children: b.parts });
  if (desktop) {
    // Pills: tinted, outlined, side by side. The app rounds a Box only through its border, and
    // a border brings a padding that made the band taller than the prompt box: paddingY, set
    // after it, takes the vertical part back.
    const pills = blocks.map((b) => Box({ ...row(b), paddingX: 1, paddingY: 0, borderStyle: "round", borderColor: b.tint[1], backgroundColor: b.tint[0] }));
    return Box({ flexDirection: "row", alignItems: "center", columnGap: 1, paddingX: 1, children: pills });
  }
  const children = [];
  blocks.forEach((b, i) => {
    if (i > 0) children.push(Box({ key: "sep-" + i, paddingX: 1, children: [Text({ dimColor: true, children: SEP })] }));
    children.push(Box(row(b)));
  });
  return Box({ flexDirection: "row", alignItems: "center", paddingX: 1, children });
}

// Width of the terminal line in characters, with the bars and details.
function textWidth(gauges, cacheNow) {
  let width = 0;
  let blocks = 0;
  if (readings.length > 0) {
    const cur = readings[readings.length - 1];
    width += 2 + short(cur.tokens).length;
    if (readings.length >= 2) width += 1 + turnDeltas().length + 1 + trendWord().length;
    blocks++;
  }
  for (const g of gauges) width += g.label.length + 1 + TEXT_CELLS + 1 + g.value.length + (g.when ? 3 + g.when.length : 0);
  blocks += gauges.length;
  if (cacheNow) {
    width += cacheText(cacheNow).length;
    blocks++;
  }
  if (cost !== null && cost >= 0.005) {
    width += T.cost(cost).length + (lastPrompt !== null && lastPrompt >= 0.005 ? 3 + T.lastPrompt(lastPrompt).length : 0);
    blocks++;
  }
  if (agents.length > 0) {
    width += T.agents(agents.length).length;
    blocks++;
  }
  return width + 3 * Math.max(0, blocks - 1) + 2;
}

// True for a tree with nothing to show: nothing, empty text, or nested empty boxes and texts.
function isBlank(node) {
  if (node == null || node === false || node === "") return true;
  if (Array.isArray(node)) return node.every(isBlank);
  if (typeof node === "string") return node.trim() === "";
  if (typeof node === "object" && (node.type === "Box" || node.type === "Text")) return isBlank(node.props?.children);
  return false;
}

function escapeXml(text) {
  return String(text).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
}

// ---------- Weather: readings and drawing (Token Weather) ----------

function pushReading(context) {
  if (!context || !context.window) return;
  const tokens = context.tokens ?? 0;
  const percent = Math.round(context.percent ?? (tokens / context.window) * 100);
  // The start reading is 0 before the first answer: drop it as soon as a real one arrives.
  readings = readings.filter((r) => r.tokens > 0);
  // A reopened session reads the same context again: no duplicate reading, so no false empty bar.
  const last = readings[readings.length - 1];
  if (last && last.tokens === tokens && tokens > 0) return;
  readings.push({ tokens, window: context.window, percent });
  if (readings.length > HISTORY) readings = readings.slice(-HISTORY);
}

function forecastFor(percent) {
  return FORECAST.find((band) => percent < band.upTo) ?? FORECAST[FORECAST.length - 1];
}

// Tokens added by each recent prompt (at most TURN_BARS), oldest first.
// A compaction lowers the context: that prompt counts as 0.
function turnDeltas() {
  const deltas = [];
  for (let i = 1; i < readings.length; i++) deltas.push(Math.max(0, readings[i].tokens - readings[i - 1].tokens));
  return deltas.slice(-TURN_BARS);
}

// Height relative to the heaviest prompt shown: the prompt that cost the most fills the height.
function barLevels() {
  const deltas = turnDeltas();
  const top = Math.max(...deltas, 1);
  return deltas.map((d) => d / top);
}

// Terminal: one character per prompt, earlier ones grey, the current one in the weather's tint.
function chartText(Text, color) {
  const glyphs = barLevels().map((level) => BARS[Math.round(level * (BARS.length - 1))]);
  const last = glyphs.pop();
  const parts = [];
  if (glyphs.length > 0) parts.push(Text({ key: "past", dimColor: true, children: glyphs.join("") }));
  parts.push(Text({ key: "now", color, children: last }));
  return parts;
}

// Just wide enough for n bars.
function barsWidth(n) {
  return Math.max(1, n) * SPARK.bar + Math.max(0, n - 1) * SPARK.gap;
}

// App: rounded bars, the most recent in color; a prompt at 0 keeps a line on the floor.
function barsSvg(color) {
  const { height, bar, gap } = SPARK;
  const levels = barLevels();
  const width = barsWidth(levels.length);
  const x0 = 0;
  const rects = levels.map((level, i) => {
    const h = Math.max(1, level * height);
    const fill = i === levels.length - 1 ? color : PAST_BAR;
    return `<rect x="${(x0 + i * (bar + gap)).toFixed(1)}" y="${(height - h).toFixed(1)}" width="${bar}" height="${h.toFixed(1)}" rx="1.5" fill="${fill}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${rects.join("")}</svg>`;
}

function trendWord() {
  if (readings.length < 2) return "";
  const delta = readings[readings.length - 1].tokens - readings[readings.length - 2].tokens;
  if (delta > 0) return `▲ +${short(delta)}`;
  if (delta < 0) return `▼ −${short(-delta)}`;
  return "=";
}

// 1M, 1.2M, 107k, 98.3k, 950: one decimal only when it matters.
function short(n) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 100_000) return `${Math.round(n / 1_000)}k`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}
