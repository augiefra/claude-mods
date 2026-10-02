// Token Weather Usage : une ligne au-dessus du prompt, blocs séparés par un trait fin.
//   ☁ Nuageux │ 44 % contexte · 440k/1M │ tours ▂▂▃▃▄▄ ▲ +698 │ 5h ━━━┃──── 37 % · 2h22 → 18:20 │ 7j ━━━━┃─── 60 % · 2j23h
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

// Courbe des tours sur l'app : mêmes teintes que la météo, en couleurs lisibles sur fond clair ou sombre.
const SPARK = { width: 60, height: 14 };
const SPARK_COLORS = { yellow: "#e0b000", cyan: "#1ba1c4", blue: "#3b7dd8", magenta: "#b04fc0", red: "#d64545" };

// Relevés du contexte : { tokens, window, percent }, du plus ancien au plus récent.
let readings = [];

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
const TRACK = "rgba(127,127,127,0.28)";
const NOW_MARK = { svg: "#4f8ef7", text: "cyan" };
// Colonnes que le terminal peut recouvrir en fin de bande.
const RESERVED_COLUMNS = 2;

export function register(on) {
  on("session.start", async ($, e, next) => {
    ticker?.cancel();
    readings = [];
    limits = { at: 0, list: [] };
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

// Barre de caractères : plein jusqu'à la part consommée, repère ┃ au temps écoulé.
function textGauge(Box, Text, g) {
  const filled = Math.round((g.used / 100) * TEXT_CELLS);
  const markAt = g.elapsed === null ? null : Math.min(TEXT_CELLS - 1, Math.floor((g.elapsed / 100) * TEXT_CELLS));
  const cell = (i) => {
    const key = "c" + i;
    if (markAt === i) return Text({ key, color: NOW_MARK.text, children: "┃" });
    return i < filled ? Text({ key, color: TONES[g.tone].text, children: "━" }) : Text({ key, dimColor: true, children: "─" });
  };
  // Cellules collées, sans l'espace du bloc entre elles.
  return Box({ key: "bar", flexDirection: "row", children: Array.from({ length: TEXT_CELLS }, (_, i) => cell(i)) });
}

function svgGauge(g) {
  const { width, height } = GAUGE;
  const radius = height / 2;
  const fill = (bound(g.used) / 100) * width;
  const mark = g.elapsed === null ? "" : `<rect x="${Math.min(width - 2, (g.elapsed / 100) * width).toFixed(1)}" y="0" width="2" height="${height}" fill="${NOW_MARK.svg}"/>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${radius}" fill="${TRACK}"/>` +
    `<rect width="${fill.toFixed(1)}" height="${height}" rx="${radius}" fill="${TONES[g.tone].svg}"/>` +
    mark +
    `</svg>`
  );
}

// ---------- Ligne ----------

function drawLine(elements, surface, columns, now) {
  const { Box, Text, Svg } = elements;
  const blocks = [];
  if (readings.length > 0) {
    const cur = readings[readings.length - 1];
    const f = forecastFor(cur.percent);
    blocks.push(Box({ key: "weather", flexDirection: "row", columnGap: 1, children: [Text({ color: f.color, bold: true, children: f.icon }), Text({ children: f.word })] }));
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
          ? Svg({ key: "spark", source: sparkSvg(SPARK_COLORS[f.color] ?? SPARK_COLORS.blue), alt: `Contexte sur les ${readings.length} derniers tours`, width: SPARK.width, height: SPARK.height })
          : Text({ key: "spark", color: f.color, children: chart() });
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
    if (readings.length >= 2) width += 6 + readings.length + 1 + trendWord().length;
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
  readings.push({ tokens, window: context.window, percent });
  if (readings.length > HISTORY) readings = readings.slice(-HISTORY);
}

function forecastFor(percent) {
  return FORECAST.find((band) => percent < band.upTo) ?? FORECAST[FORECAST.length - 1];
}

// Barres sur l'échelle de la fenêtre (0 à 100 %) : la pente se lit, un tour coûteux fait une marche.
function chart() {
  return readings.map((r) => BARS[Math.min(BARS.length - 1, Math.max(0, Math.round((r.percent / 100) * (BARS.length - 1))))]).join("");
}

// Courbe pleine du remplissage du contexte, de 0 (bas) à 100 % (haut), sur les derniers tours.
function sparkSvg(color) {
  const { width, height } = SPARK;
  const step = readings.length > 1 ? width / (readings.length - 1) : width;
  const points = readings.map((r, i) => `${(i * step).toFixed(1)},${(height - (Math.min(100, Math.max(0, r.percent)) / 100) * (height - 1) - 0.5).toFixed(1)}`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="2" fill="${TRACK}"/>` +
    `<polygon points="0,${height} ${points.join(" ")} ${width},${height}" fill="${color}" fill-opacity="0.35"/>` +
    `<polyline points="${points.join(" ")}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>` +
    `</svg>`
  );
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
