// Token Weather Usage: one line above the prompt, blocks split by a thin rule.
//   ☁ Cloudy │ 44% context · 440k/1M │ turns ▃▆▂█▃▄▂▇ ▲ +8.4k │ 5h ━━━╍╍╍── 37% · 2h22 → 18:20 │ 7d ━━━━╍─── 60% · 2d23h
//
// Weather, context and recent turns: adapted from the Token Weather example,
//   Copyright 2026 Anthropic PBC, SPDX-License-Identifier: Apache-2.0 (claude-code-playground).
// 5-hour and 7-day limits: written for this mod after HolyGrail's usage-meter
//   (https://github.com/HolyGrail/claude-mods/tree/main/plugins/usage-meter), without copying its code.
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
    context: "context",
    turns: "turns",
    labels: { five_hour: "5h", seven_day: "7d", spend_limit: "$" },
    day: "d",
    turnsAlt: (n) => `Tokens added by the last ${n} prompts`,
    gaugeAlt: (label, value) => `${label}: ${value} used`,
  },
  fr: {
    weather: { clear: "Clair", cloudy: "Nuageux", showers: "Averses", storm: "Orage", compact: "Compacter bientôt" },
    percent: (n) => `${n} %`,
    context: "contexte",
    turns: "tours",
    labels: { five_hour: "5h", seven_day: "7j", spend_limit: "$" },
    day: "j",
    turnsAlt: (n) => `Tokens ajoutés par les ${n} derniers prompts`,
    gaugeAlt: (label, value) => `${label} : ${value} consommés`,
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

function weatherSvg(id) {
  const draw = WEATHER_ICONS[id];
  if (!draw) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WEATHER_ICON_SIZE}" height="${WEATHER_ICON_SIZE}" viewBox="0 0 24 24">${draw(WEATHER_ICON_COLORS[id])}</svg>`;
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
// Columns the terminal may cover at the end of the band.
const RESERVED_COLUMNS = 2;

export function register(on, options) {
  const language = options?.language;

  on("session.start", async ($, e, next) => {
    ticker?.cancel();
    T = TEXT[await languageOf($, language)];
    readings = [];
    limits = { at: 0, list: [] };
    turnsKey = TURNS_PREFIX + (await $.session.id());
    await restoreTurns($);
    const usage = await $.session.usage();
    pushReading(usage.context);
    // On start or reload the local reading may be stale (an idle session): the shared reading
    // wins, and the local one is published only when none exists yet.
    await adoptShared($);
    if (limits.list.length === 0 && usage.rateLimits.length > 0) await shareLimits($, usage.rateLimits);
    // Every minute: elapsed time moves on, and another session may have measured something newer.
    ticker = $.clock.every(MINUTE, async () => {
      await adoptShared($);
      $.ui.invalidate("ui.render");
    });
    $.ui.invalidate("ui.render");
    return next(e);
  });

  on("session.end", async ($, e, next) => {
    // A real end (exit, or process stopped); /clear, /resume and disconnect keep the ticker.
    if (e.reason === "prompt_input_exit" || e.reason === "other") ticker?.cancel();
    return next(e);
  });

  // One context reading after each main turn (not subagents' turns).
  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId) return result;
    try {
      pushReading((await $.session.usage()).context);
      await saveTurns($);
      $.ui.invalidate("ui.render");
    } catch {
      // No reading this turn: the line keeps the previous one.
    }
    return result;
  });

  on("session.measure", async ($, e, next) => {
    if (e.changed.includes("rateLimits") && e.rateLimits.length > 0) await shareLimits($, e.rateLimits);
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

// Restores this session's readings, and deletes those of sessions idle for more than 8 days.
async function restoreTurns($) {
  const now = await $.clock.now();
  try {
    for (const key of await $.store.keys()) {
      if (!key.startsWith(TURNS_PREFIX)) continue;
      const saved = await $.store.get(key);
      if (key === turnsKey && saved && Array.isArray(saved.readings)) readings = saved.readings.filter((r) => r && r.window > 0).slice(-HISTORY);
      else if (!saved || !(now - saved.at < TURNS_KEEP_MS)) await $.store.delete(key);
    }
  } catch {
    // Unreadable store: the line starts from scratch.
  }
}

async function saveTurns($) {
  if (!turnsKey) return;
  try {
    await $.store.set(turnsKey, { at: await $.clock.now(), readings });
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
  let detail = "";
  if (left !== null) detail = limit.kind === "five_hour" ? `· ${duration(left)} → ${clockTime(resetMs)}` : `· ${duration(left)}`;
  return { label: T.labels[limit.kind] ?? limit.kind, used, elapsed, tone, value: T.percent(Math.round(used)), detail };
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

// ---------- Limits: gauges ----------

function gaugeBlock({ Box, Text, Svg }, mode, g) {
  // The bar carries the color; the text stays in the theme's color, readable everywhere.
  const parts = [Text({ key: "l", children: g.label })];
  if (mode === "svg" && Svg) parts.push(Svg({ key: "g", source: svgGauge(g), alt: T.gaugeAlt(g.label, g.value), width: GAUGE.width, height: GAUGE.height }));
  if (mode === "text") parts.push(textGauge(Box, Text, g));
  parts.push(Text(g.tone === "alert" ? { key: "v", bold: true, color: TONES.alert.text, children: g.value } : { key: "v", bold: true, children: g.value }));
  // Terminal too narrow: the detail goes with the bar, leaving the label and the percentage.
  if (g.detail && mode !== "none") parts.push(Text({ key: "d", dimColor: true, children: g.detail }));
  return Box({ key: "gauge-" + g.label, flexDirection: "row", columnGap: 1, alignItems: "center", children: parts });
}

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
  const blocks = [];
  if (readings.length > 0) {
    const cur = readings[readings.length - 1];
    const f = forecastFor(cur.percent);
    const word = T.weather[f.id];
    const iconSvg = surface === "desktop" && Svg ? weatherSvg(f.id) : null;
    const icon = iconSvg
      ? Svg({ key: "icon", source: iconSvg, alt: word, width: WEATHER_ICON_SIZE, height: WEATHER_ICON_SIZE })
      : Text({ key: "icon", color: f.color, bold: true, children: f.icon });
    blocks.push(Box({ key: "weather", flexDirection: "row", columnGap: 1, alignItems: "center", children: [icon, Text({ key: "word", children: word })] }));
    blocks.push(
      Box({
        key: "context",
        flexDirection: "row",
        columnGap: 1,
        children: [Text({ children: contextText(cur) }), Text({ dimColor: true, children: tokensText(cur) })],
      }),
    );
    // A single reading draws no trend: the block waits for the second turn.
    if (readings.length >= 2) {
      const curve =
        surface === "desktop" && Svg
          ? Svg({ key: "spark", source: barsSvg(SPARK_COLORS[f.color] ?? SPARK_COLORS.blue), alt: T.turnsAlt(turnDeltas().length), width: barsWidth(turnDeltas().length), height: SPARK.height })
          : Box({ key: "spark", flexDirection: "row", children: chartText(Text, f.color) });
      const turns = [Text({ key: "t", dimColor: true, children: T.turns }), curve];
      const trend = trendWord();
      if (trend) turns.push(Text({ key: "d", dimColor: true, children: trend }));
      blocks.push(Box({ key: "turns", flexDirection: "row", columnGap: 1, alignItems: "center", children: turns }));
    }
  }
  // A window that already reset has no valid reading: hidden until the next one.
  const gauges = limits.list.filter((limit) => !(Date.parse(limit.resetsAt ?? "") <= now)).map((limit) => gaugeOf(limit, now));
  // Drawn bars in the app; in the terminal, characters when the line fits, otherwise no bar or detail.
  let mode = "svg";
  if (surface !== "desktop") mode = textWidth(gauges) <= columns - RESERVED_COLUMNS ? "text" : "none";
  for (const g of gauges) blocks.push(gaugeBlock(elements, mode, g));

  const children = [];
  blocks.forEach((block, i) => {
    if (i > 0) children.push(Box({ key: "sep-" + i, paddingX: 1, children: [Text({ dimColor: true, children: SEP })] }));
    children.push(block);
  });
  return Box({ flexDirection: "row", alignItems: "center", paddingX: 1, children });
}

// "44% context", and "· 440k/1M" in grey.
function contextText(cur) {
  return `${T.percent(cur.percent)} ${T.context}`;
}

function tokensText(cur) {
  return `· ${short(cur.tokens)}/${short(cur.window)}`;
}

// Width of the line in characters with the bars, for the terminal.
function textWidth(gauges) {
  let width = 0;
  if (readings.length > 0) {
    const cur = readings[readings.length - 1];
    width += 2 + T.weather[forecastFor(cur.percent).id].length;
    width += `${contextText(cur)} ${tokensText(cur)}`.length;
    if (readings.length >= 2) width += T.turns.length + 1 + turnDeltas().length + 1 + trendWord().length;
  }
  for (const g of gauges) width += g.label.length + 1 + TEXT_CELLS + 1 + g.value.length + (g.detail ? 1 + g.detail.length : 0);
  const blocks = (readings.length > 0 ? (readings.length >= 2 ? 3 : 2) : 0) + gauges.length;
  return width + 3 * Math.max(0, blocks - 1) + 2;
}

// True for a tree with nothing to show: nothing, empty text, or nested empty boxes and texts.
// An element carries its children beside its props, not inside them.
function isBlank(node) {
  if (node == null || node === false || node === "") return true;
  if (Array.isArray(node)) return node.every(isBlank);
  if (typeof node === "string") return node.trim() === "";
  if (typeof node === "object" && (node.type === "Box" || node.type === "Text")) return isBlank(node.children ?? node.props?.children);
  return false;
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

// Just wide enough for n bars: the area grows with the prompts, with no gap next to "turns".
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
