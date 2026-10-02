// Token Weather Usage : une ligne au-dessus du prompt, blocs séparés par un trait fin.
//   ☁ Nuageux │ 44 % contexte · 440k/1M │ tours ▃▆▂█▃▄▂▇ ▲ +8.4k │ 5h ━━━╍╍╍── 37 % · 2h22 → 18:20 │ 7j ━━━━╍─── 60 % · 2j23h
//
// Météo, contexte et derniers tours : adapté de l'exemple Token Weather,
//   Copyright 2026 Anthropic PBC, SPDX-License-Identifier: Apache-2.0 (claude-code-playground).
// Limites 5 h et 7 jours : écrites pour ce mod d'après usage-meter de HolyGrail
//   (https://github.com/HolyGrail/claude-mods/tree/main/plugins/usage-meter), sans copie de son code.
//
// Le moteur lit on(...) et $.noun.method(...) dans le source : ils restent écrits en toutes
// lettres, et les fonctions qui reçoivent $ sont au premier niveau.

// ---------- Météo du contexte (Token Weather) ----------

const HISTORY = 12;
const BARS = "▁▂▃▄▅▆▇█";
const FORECAST = [
  // Symboles d'une seule colonne, pas d'emoji : ils s'alignent dans toutes les polices.
  { upTo: 25, icon: "☀", word: "Clair", color: "yellow" },
  { upTo: 50, icon: "☁", word: "Nuageux", color: "cyan" },
  { upTo: 75, icon: "☂", word: "Averses", color: "blue" },
  { upTo: 90, icon: "☇", word: "Orage", color: "magenta" },
  { upTo: Infinity, icon: "↯", word: "Compacter bientôt", color: "red" },
];

// Barres des tours : tokens ajoutés par chacun des derniers prompts ; le prompt actuel prend la teinte
// de la météo (couleurs lisibles sur fond clair ou sombre), les précédents restent gris.
const TURN_BARS = 8;
const SPARK = { height: 14, bar: 5.5, gap: 2 };
const PAST_BAR = "rgba(127,127,127,0.45)";
const SPARK_COLORS = { yellow: "#e0b000", cyan: "#1ba1c4", blue: "#2f68c0", magenta: "#b04fc0", red: "#d64545" };

// Icônes météo dessinées pour l'app (le terminal garde les symboles Unicode de FORECAST) : pleines,
// 15 px, chacune dans sa teinte. « Compacter bientôt » reprend le zigzag ↯, en trait épais.
const WEATHER_ICON_SIZE = 15;
const WEATHER_ICONS = {
  Clair: (c) =>
    `<circle cx="12" cy="12" r="4.5" fill="${c}"/><path fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`,
  Nuageux: (c) =>
    `<path fill="${c}" stroke="${c}" stroke-width="1.5" stroke-linejoin="round" d="M7 18.5a3.75 3.75 0 0 1-.4-7.48A5.6 5.6 0 0 1 17.2 9.6a4.45 4.45 0 0 1 .3 8.9z"/>`,
  Averses: (c) =>
    `<path fill="${c}" stroke="${c}" stroke-width="1.5" stroke-linejoin="round" d="M7 14.5a3.25 3.25 0 0 1-.35-6.48A5 5 0 0 1 16.2 6.8a3.85 3.85 0 0 1 .3 7.7z"/><path fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>`,
  Orage: (c) => `<path fill="${c}" stroke="${c}" stroke-width="1.5" stroke-linejoin="round" d="M13.5 2 5 13.5h6.5L10.5 22 19 10.5h-6.5z"/>`,
  "Compacter bientôt": (c) =>
    `<path fill="none" stroke="${c}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" d="M14 2 7 12h8l-5 9M14.5 18.8 10 21l-.5-5"/>`,
};
const WEATHER_ICON_COLORS = { Clair: "#e0b000", Nuageux: "#8ea3b8", Averses: "#2f68c0", Orage: "#b04fc0", "Compacter bientôt": "#d64545" };

function weatherSvg(word) {
  const draw = WEATHER_ICONS[word];
  if (!draw) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WEATHER_ICON_SIZE}" height="${WEATHER_ICON_SIZE}" viewBox="0 0 24 24">${draw(WEATHER_ICON_COLORS[word])}</svg>`;
}

// Relevés du contexte : { tokens, window, percent }, du plus ancien au plus récent.
let readings = [];
// Les relevés de chaque fil sont gardés dans $.store, pour retrouver les barres après un redémarrage.
const TURNS_PREFIX = "turns:";
const TURNS_KEEP_MS = 8 * 24 * 3_600_000;
let turnsKey = null;

// ---------- Limites du compte ----------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Durée de chaque fenêtre ; sans durée (plafond de dépenses), pas de repère de temps écoulé.
const SPANS = { five_hour: 5 * HOUR, seven_day: 7 * DAY };
const LABELS = { five_hour: "5h", seven_day: "7j", spend_limit: "$" };
// Ordre d'affichage ; une fenêtre inconnue passe après.
const ORDER = ["five_hour", "seven_day", "spend_limit"];
// Rythme = part consommée moins part du temps écoulée, en points.
// Au-dessus de 0 : on consomme plus vite que le temps ; au-delà de 15, ou à 90 % consommés : alerte.
const PACE_ALERT = 15;
const USED_ALERT = 90;
// Les limites sont celles du compte : la dernière mesure, toutes sessions confondues, vit dans $.store.
const SHARED_KEY = "limits";

// Dernière mesure connue : { at (ms), list: SessionRateLimit[] }.
let limits = { at: 0, list: [] };
let ticker = null;

// ---------- Mise en page ----------

const SEP = "│";
const TEXT_CELLS = 8;
const GAUGE = { width: 72, height: 9 };
const TONES = {
  calm: { svg: "#3fa66b", text: "green" },
  fast: { svg: "#d9962b", text: "yellow" },
  alert: { svg: "#d64545", text: "red" },
};
const TRACK = "rgba(127,127,127,0.2)";
// Hachures de l'écart quand on va moins vite que le temps : rayures grises sur le fond de la jauge.
const HATCH = { back: "rgba(127,127,127,0.16)", line: "rgba(127,127,127,0.6)" };
// Colonnes que le terminal peut recouvrir en fin de bande.
const RESERVED_COLUMNS = 2;

export function register(on) {
  on("session.start", async ($, e, next) => {
    ticker?.cancel();
    readings = [];
    limits = { at: 0, list: [] };
    turnsKey = TURNS_PREFIX + (await $.session.id());
    await restoreTurns($);
    const usage = await $.session.usage();
    pushReading(usage.context);
    // Au démarrage ou au rechargement, la mesure locale peut dater (fil resté inactif) : la mesure
    // partagée prime, et la locale n'est publiée que si aucune n'existe encore.
    await adoptShared($);
    if (limits.list.length === 0 && usage.rateLimits.length > 0) await shareLimits($, usage.rateLimits);
    // Toutes les minutes : le temps écoulé avance, et une autre session a pu mesurer plus récent.
    ticker = $.clock.every(MINUTE, async () => {
      await adoptShared($);
      $.ui.invalidate("ui.render");
    });
    $.ui.invalidate("ui.render");
    return next(e);
  });

  on("session.end", async ($, e, next) => {
    // Fin réelle (sortie, ou processus arrêté) ; /clear, /resume et la déconnexion gardent la minuterie.
    if (e.reason === "prompt_input_exit" || e.reason === "other") ticker?.cancel();
    return next(e);
  });

  // Un relevé de contexte après chaque tour principal (pas ceux des sous-agents).
  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId) return result;
    try {
      pushReading((await $.session.usage()).context);
      await saveTurns($);
      $.ui.invalidate("ui.render");
    } catch {
      // Pas de relevé ce tour-ci : la ligne garde le précédent.
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
    // Les mods placés après dessinent sous notre ligne ; un dessin vide n'ajoute pas de ligne blanche.
    const below = await next(e);
    return isBlank(below) ? line : elements.Box({ flexDirection: "column", children: [line, below] });
  });
}

// ---------- Tours : relevés gardés par fil ----------

// Reprend les relevés de ce fil, et efface ceux des fils inactifs depuis plus de 8 jours.
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
    // Stockage illisible : la ligne repart de zéro.
  }
}

async function saveTurns($) {
  if (!turnsKey) return;
  try {
    await $.store.set(turnsKey, { at: await $.clock.now(), readings });
  } catch {
    // Pas de sauvegarde ce tour-ci : les barres reviendront au tour suivant.
  }
}

// ---------- Limites : mesure partagée ----------

// Garde la mesure de cette session et la publie si elle est la plus récente connue.
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

// Reprend la mesure d'une autre session quand elle est plus récente que la nôtre.
async function adoptShared($) {
  try {
    const stored = await $.store.get(SHARED_KEY);
    if (stored && Array.isArray(stored.list) && stored.at > limits.at) limits = { at: stored.at, list: sortLimits(stored.list) };
  } catch {
    // Stockage illisible : on garde la mesure locale.
  }
}

function sortLimits(list) {
  const rank = (kind) => (ORDER.includes(kind) ? ORDER.indexOf(kind) : ORDER.length);
  return [...list].sort((a, b) => rank(a.kind) - rank(b.kind));
}

// ---------- Limites : lecture d'une fenêtre ----------

// Ce que la ligne affiche d'une fenêtre : part consommée, temps écoulé, ton, détail en gris.
function gaugeOf(limit, now) {
  const used = Math.max(0, limit.percentUsed);
  const resetMs = limit.resetsAt ? Date.parse(limit.resetsAt) : NaN;
  const span = SPANS[limit.kind];
  const left = Number.isFinite(resetMs) ? Math.max(0, resetMs - now) : null;
  const elapsed = span && left !== null ? bound(((span - left) / span) * 100) : null;
  const pace = elapsed === null ? 0 : used - elapsed;
  const tone = used >= USED_ALERT || pace > PACE_ALERT ? "alert" : pace > 0 ? "fast" : "calm";
  let detail = "";
  if (left !== null) detail = limit.kind === "five_hour" ? `· ${duration(left)} → ${parisTime(resetMs)}` : `· ${duration(left)}`;
  return { label: LABELS[limit.kind] ?? limit.kind, used, elapsed, tone, value: `${Math.round(used)} %`, detail };
}

// 3h02, 42 min, 2j23h.
function duration(ms) {
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${minutes} min`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}j${String(hours).padStart(2, "0")}h`;
  return `${hours}h${String(minutes % 60).padStart(2, "0")}`;
}

// Heure de Paris (CET/CEST) sans dépendre du fuseau de la machine.
function parisTime(ms) {
  const year = new Date(ms).getUTCFullYear();
  // Heure d'été du dernier dimanche de mars au dernier dimanche d'octobre, à 01:00 UTC.
  const summer = ms >= lastSundayAt1Utc(year, 3) && ms < lastSundayAt1Utc(year, 10);
  const offset = summer ? 2 : 1;
  const local = new Date(ms + offset * HOUR);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

// Dernier dimanche du mois (1 à 12), 01:00 UTC, en ms.
function lastSundayAt1Utc(year, month) {
  for (let day = 31; day >= 25; day--) {
    const t = Date.UTC(year, month - 1, day, 1);
    const d = new Date(t);
    if (d.getUTCMonth() === month - 1 && d.getUTCDay() === 0) return t;
  }
  return Date.UTC(year, month - 1, 25, 1);
}

function bound(percent) {
  return Math.min(100, Math.max(0, percent));
}

// ---------- Limites : jauges ----------

function gaugeBlock({ Box, Text, Svg }, mode, g) {
  // La couleur est portée par la barre ; le texte reste dans la couleur du thème, lisible partout.
  const parts = [Text({ key: "l", children: g.label })];
  if (mode === "svg" && Svg) parts.push(Svg({ key: "g", source: svgGauge(g), alt: `${g.label} : ${g.value} consommés`, width: GAUGE.width, height: GAUGE.height }));
  if (mode === "text") parts.push(textGauge(Box, Text, g));
  parts.push(Text(g.tone === "alert" ? { key: "v", bold: true, color: TONES.alert.text, children: g.value } : { key: "v", bold: true, children: g.value }));
  // Terminal trop étroit : le détail tombe avec la barre, il reste le libellé et le pourcentage.
  if (g.detail && mode !== "none") parts.push(Text({ key: "d", dimColor: true, children: g.detail }));
  return Box({ key: "gauge-" + g.label, flexDirection: "row", columnGap: 1, alignItems: "center", children: parts });
}

// Barre de caractères : trait plein jusqu'à la part consommée ; l'écart avec le temps écoulé en
// pointillé épais ╍, dans la couleur de la barre si on va plus vite que le temps, en gris sinon.
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
  // Cellules collées, sans l'espace du bloc entre elles.
  return Box({ key: "bar", flexDirection: "row", children: Array.from({ length: TEXT_CELLS }, (_, i) => cell(i)) });
}

// Jauge dessinée : barre pleine jusqu'à la part consommée ; l'écart avec le temps écoulé est hachuré,
// en gris après la barre (marge restante) ou dans la couleur de la barre (avance sur le temps).
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

// ---------- Ligne ----------

function drawLine(elements, surface, columns, now) {
  const { Box, Text, Svg } = elements;
  const blocks = [];
  if (readings.length > 0) {
    const cur = readings[readings.length - 1];
    const f = forecastFor(cur.percent);
    const iconSvg = surface === "desktop" && Svg ? weatherSvg(f.word) : null;
    const icon = iconSvg
      ? Svg({ key: "icon", source: iconSvg, alt: f.word, width: WEATHER_ICON_SIZE, height: WEATHER_ICON_SIZE })
      : Text({ key: "icon", color: f.color, bold: true, children: f.icon });
    blocks.push(Box({ key: "weather", flexDirection: "row", columnGap: 1, alignItems: "center", children: [icon, Text({ key: "word", children: f.word })] }));
    blocks.push(
      Box({
        key: "context",
        flexDirection: "row",
        columnGap: 1,
        children: [Text({ children: `${cur.percent} % contexte` }), Text({ dimColor: true, children: `· ${short(cur.tokens)}/${short(cur.window)}` })],
      }),
    );
    // Un seul relevé ne dessine pas de tendance : le bloc attend le deuxième tour.
    if (readings.length >= 2) {
      const curve =
        surface === "desktop" && Svg
          ? Svg({ key: "spark", source: barsSvg(SPARK_COLORS[f.color] ?? SPARK_COLORS.blue), alt: `Tokens ajoutés par les ${turnDeltas().length} derniers prompts`, width: barsWidth(turnDeltas().length), height: SPARK.height })
          : Box({ key: "spark", flexDirection: "row", children: chartText(Text, f.color) });
      const turns = [Text({ key: "t", dimColor: true, children: "tours" }), curve];
      const trend = trendWord();
      if (trend) turns.push(Text({ key: "d", dimColor: true, children: trend }));
      blocks.push(Box({ key: "turns", flexDirection: "row", columnGap: 1, alignItems: "center", children: turns }));
    }
  }
  // Une fenêtre déjà remise à zéro n'a plus de mesure valable : masquée jusqu'à la suivante.
  const gauges = limits.list.filter((limit) => !(Date.parse(limit.resetsAt ?? "") <= now)).map((limit) => gaugeOf(limit, now));
  // Barres dessinées sur l'app ; au terminal, en caractères si la ligne tient, sinon sans barre ni détail.
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

// Largeur de la ligne en caractères avec les barres, pour le terminal.
function textWidth(gauges) {
  let width = 0;
  if (readings.length > 0) {
    const cur = readings[readings.length - 1];
    width += 2 + forecastFor(cur.percent).word.length;
    width += `${cur.percent} % contexte · ${short(cur.tokens)}/${short(cur.window)}`.length;
    if (readings.length >= 2) width += 6 + turnDeltas().length + 1 + trendWord().length;
  }
  for (const g of gauges) width += g.label.length + 1 + TEXT_CELLS + 1 + g.value.length + (g.detail ? 1 + g.detail.length : 0);
  const blocks = (readings.length > 0 ? (readings.length >= 2 ? 3 : 2) : 0) + gauges.length;
  return width + 3 * Math.max(0, blocks - 1) + 2;
}

// Vrai pour un arbre sans rien à afficher : rien, texte vide, ou boîtes et textes vides imbriqués.
function isBlank(node) {
  if (node == null || node === false || node === "") return true;
  if (Array.isArray(node)) return node.every(isBlank);
  if (typeof node === "string") return node.trim() === "";
  if (typeof node === "object" && (node.type === "Box" || node.type === "Text")) return isBlank(node.props?.children);
  return false;
}

// ---------- Météo : relevés et rendu (Token Weather) ----------

function pushReading(context) {
  if (!context || !context.window) return;
  const tokens = context.tokens ?? 0;
  const percent = Math.round(context.percent ?? (tokens / context.window) * 100);
  // Le relevé de démarrage vaut 0 avant la première réponse : l'écarter dès qu'un vrai arrive.
  readings = readings.filter((r) => r.tokens > 0);
  // Une réouverture relit le même contexte : pas de relevé en double, donc pas de fausse barre vide.
  const last = readings[readings.length - 1];
  if (last && last.tokens === tokens && tokens > 0) return;
  readings.push({ tokens, window: context.window, percent });
  if (readings.length > HISTORY) readings = readings.slice(-HISTORY);
}

function forecastFor(percent) {
  return FORECAST.find((band) => percent < band.upTo) ?? FORECAST[FORECAST.length - 1];
}

// Tokens ajoutés par chacun des derniers prompts (au plus TURN_BARS), du plus ancien au plus récent.
// Une compaction fait baisser le contexte : ce prompt compte pour 0.
function turnDeltas() {
  const deltas = [];
  for (let i = 1; i < readings.length; i++) deltas.push(Math.max(0, readings[i].tokens - readings[i - 1].tokens));
  return deltas.slice(-TURN_BARS);
}

// Hauteur relative au prompt le plus lourd affiché : le prompt qui a coûté le plus remplit la hauteur.
function barLevels() {
  const deltas = turnDeltas();
  const top = Math.max(...deltas, 1);
  return deltas.map((d) => d / top);
}

// Terminal : un caractère par prompt, les précédents en gris, l'actuel dans la teinte de la météo.
function chartText(Text, color) {
  const glyphs = barLevels().map((level) => BARS[Math.round(level * (BARS.length - 1))]);
  const last = glyphs.pop();
  const parts = [];
  if (glyphs.length > 0) parts.push(Text({ key: "past", dimColor: true, children: glyphs.join("") }));
  parts.push(Text({ key: "now", color, children: last }));
  return parts;
}

// Largeur juste pour n barres : la zone grandit avec les prompts, sans vide à côté de « tours ».
function barsWidth(n) {
  return Math.max(1, n) * SPARK.bar + Math.max(0, n - 1) * SPARK.gap;
}

// App : barres arrondies, la plus récente en couleur ; un prompt à 0 garde un trait au sol.
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

// 1M, 1.2M, 107k, 98.3k, 950 : une décimale seulement quand elle compte.
function short(n) {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 100_000) return `${Math.round(n / 1_000)}k`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}
