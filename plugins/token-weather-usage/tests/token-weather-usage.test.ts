import { test, expect, mock } from "claude-code/testing";

// 2 octobre 2026, 15:00 à Paris.
const NOW = Date.UTC(2026, 9, 2, 13, 0);
const LIMITS = [
  // 7 jours : 59 % consommés, 4 jours écoulés sur 7 (57 %) : un peu en avance, jaune.
  { kind: "seven_day", percentUsed: 59, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString() },
  // 5 heures : 32 % consommés, 2 h écoulées sur 5 (40 %) : en avance sur le temps, vert.
  { kind: "five_hour", percentUsed: 32, resetsAt: new Date(NOW + 3 * 3_600_000).toISOString() },
];

function world(on: any) {
  mock.clock(on, { now: NOW });
  mock.store(on);
  on("session.id", () => ({ value: "fil-1" }));
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
  on("session.usage", () => ({ value: { startedAt: NOW, context: { tokens: 107_000, window: 1_000_000, percent: 11 }, rateLimits: LIMITS } }));
}

for (const surface of ["terminal", "desktop"] as const) {
  test(`bande ${surface}`, async ($, on) => {
    world(on);
    await $.session.start({ source: "startup", cwd: "/tmp" } as any);
    const ui = await $.ui.mount({ plugin: "token-weather-usage", surface, component: "AbovePrompt", props: { bodyColumns: 200 } as any });
    const texts = (await ui.findAll({ type: "Text" })).map((t: any) => t.text);
    expect(texts).toContain("Clair");
    expect(texts).toContain("11 % contexte");
    expect(texts).toContain("5h");
    expect(texts).toContain("32 %");
    expect(texts).toContain("· 3h00 → 18:00");
    expect(texts).toContain("59 %");
    expect(texts).toContain("· 3j00h");
    // 5 h avant 7 j, quel que soit l'ordre reçu.
    expect(texts.indexOf("5h")).toBeLessThan(texts.indexOf("7j"));
    // Un seul relevé : pas encore de graphique des tours.
    expect(texts).not.toContain("tours");
    // Hors alerte, le pourcentage garde la couleur du thème.
    const value: any = await ui.find({ type: "Text", text: "59 %" });
    expect(value?.props?.color).toBeUndefined();
    expect(value?.props?.bold).toBe(true);
  });
}

test("fenêtre déjà remise à zéro : masquée", async ($, on) => {
  mock.clock(on, { now: NOW });
  mock.store(on);
  on("session.id", () => ({ value: "fil-1" }));
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
  const stale = [
    { kind: "five_hour", percentUsed: 80, resetsAt: new Date(NOW - 60_000).toISOString() },
    { kind: "seven_day", percentUsed: 59, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString() },
  ];
  on("session.usage", () => ({ value: { startedAt: NOW, context: { tokens: 107_000, window: 1_000_000, percent: 11 }, rateLimits: stale } }));
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const ui = await $.ui.mount({ plugin: "token-weather-usage", surface: "terminal", component: "AbovePrompt", props: { bodyColumns: 200 } as any });
  const texts = (await ui.findAll({ type: "Text" })).map((t: any) => t.text);
  expect(texts).not.toContain("5h");
  expect(texts).toContain("7j");
});

for (const surface of ["terminal", "desktop"] as const) {
  test(`tours après deux relevés ${surface}`, async ($, on) => {
    mock.clock(on, { now: NOW });
    mock.store(on);
    on("session.id", () => ({ value: "fil-1" }));
    on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
    on("ui.invalidate", () => ({ value: undefined }));
    on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
    on("turn.complete", () => ({ text: "" }));
    // 4 relevés : +20k, +80k, +10k tokens.
    const fills = [10, 12, 20, 21];
    let call = 0;
    on("session.usage", () => {
      const percent = fills[Math.min(call++, fills.length - 1)];
      return { value: { startedAt: NOW, context: { tokens: percent * 10_000, window: 1_000_000, percent }, rateLimits: LIMITS } };
    });
    await $.session.start({ source: "startup", cwd: "/tmp" } as any);
    for (let i = 0; i < 3; i++) await ($ as any).turn.complete({ answer: "ok" } as any);
    const ui = await $.ui.mount({ plugin: "token-weather-usage", surface, component: "AbovePrompt", props: { bodyColumns: 200 } as any });
    const texts = (await ui.findAll({ type: "Text" })).map((t: any) => t.text);
    expect(texts).toContain("tours");
    expect(texts).toContain("Clair");
    expect(texts).toContain("▲ +10k");
    if (surface === "terminal") {
      expect(texts).toContain("☀");
      // Précédents en gris (+20k puis +80k, le plus lourd), prompt actuel (+10k) en couleur.
      expect(texts).toContain("▃█");
      const now: any = await ui.find({ type: "Text", text: "▂" });
      expect(now?.props?.color).toBe("yellow");
    }
    else {
      const svgs = await ui.findAll({ type: "Svg" });
      // Icône météo dessinée, barres des tours, deux jauges.
      expect(svgs.length).toBe(4);
      expect(texts).not.toContain("☀");
    }
  });
}

test("au démarrage, la mesure partagée prime sur une mesure locale ancienne", async ($, on) => {
  mock.clock(on, { now: NOW });
  // Un autre fil a mesuré 63 % il y a 2 minutes.
  mock.store(on, {
    limits: { at: NOW - 120_000, list: [{ kind: "five_hour", percentUsed: 63, resetsAt: new Date(NOW + 3 * 3_600_000).toISOString() }] },
  });
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("session.id", () => ({ value: "fil-1" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
  // Ce fil, resté inactif, garde une vieille mesure à 34 %.
  const old = [{ kind: "five_hour", percentUsed: 34, resetsAt: new Date(NOW + 3 * 3_600_000).toISOString() }];
  on("session.usage", () => ({ value: { startedAt: NOW, context: { tokens: 107_000, window: 1_000_000, percent: 11 }, rateLimits: old } }));
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const ui = await $.ui.mount({ plugin: "token-weather-usage", surface: "terminal", component: "AbovePrompt", props: { bodyColumns: 200 } as any });
  const texts = (await ui.findAll({ type: "Text" })).map((t: any) => t.text);
  expect(texts).toContain("63 %");
  expect(texts).not.toContain("34 %");
});

test("alerte : pourcentage en rouge à 90 % ou plus", async ($, on) => {
  mock.clock(on, { now: NOW });
  mock.store(on);
  on("session.id", () => ({ value: "fil-1" }));
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
  const hot = [{ kind: "five_hour", percentUsed: 95, resetsAt: new Date(NOW + 3 * 3_600_000).toISOString() }];
  on("session.usage", () => ({ value: { startedAt: NOW, context: { tokens: 107_000, window: 1_000_000, percent: 11 }, rateLimits: hot } }));
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const ui = await $.ui.mount({ plugin: "token-weather-usage", surface: "desktop", component: "AbovePrompt", props: { bodyColumns: 200 } as any });
  const value: any = await ui.find({ type: "Text", text: "95 %" });
  expect(value?.props?.color).toBe("red");
});

test("terminal étroit : ni barre ni détail", async ($, on) => {
  world(on);
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const ui = await $.ui.mount({ plugin: "token-weather-usage", surface: "terminal", component: "AbovePrompt", props: { bodyColumns: 60 } as any });
  const texts = (await ui.findAll({ type: "Text" })).map((t: any) => t.text);
  expect(texts).toContain("32 %");
  expect(texts).not.toContain("━");
  expect(texts).not.toContain("· 3h00 → 18:00");
});

test("après un redémarrage, les barres des tours reviennent", async ($, on) => {
  mock.clock(on, { now: NOW });
  // Stockage en mémoire : le même fil avait déjà 3 relevés (+20k, puis +80k) ; un autre fil dort depuis 9 jours.
  const store = new Map<string, unknown>([
    ["turns:fil-1", { at: NOW - 60_000, readings: [10, 12, 20].map((p) => ({ tokens: p * 10_000, window: 1_000_000, percent: p })) }],
    ["turns:vieux-fil", { at: NOW - 9 * 86_400_000, readings: [] }],
  ]);
  on("store.get", (_$: any, e: any) => ({ value: store.get(e.key) }));
  on("store.set", (_$: any, e: any) => (store.set(e.key, e.value), { value: undefined }));
  on("store.delete", (_$: any, e: any) => (store.delete(e.key), { value: undefined }));
  on("store.keys", () => ({ value: [...store.keys()] }));
  on("session.id", () => ({ value: "fil-1" }));
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
  // À la réouverture, le contexte est le même que le dernier relevé : pas de relevé en double.
  on("session.usage", () => ({ value: { startedAt: NOW, context: { tokens: 200_000, window: 1_000_000, percent: 20 }, rateLimits: LIMITS } }));
  await $.session.start({ source: "resume", cwd: "/tmp" } as any);
  const ui = await $.ui.mount({ plugin: "token-weather-usage", surface: "terminal", component: "AbovePrompt", props: { bodyColumns: 200 } as any });
  const texts = (await ui.findAll({ type: "Text" })).map((t: any) => t.text);
  expect(texts).toContain("tours");
  expect(texts).toContain("▲ +80k");
  // Le fil inactif depuis plus de 8 jours est effacé, pas celui-ci.
  expect(store.has("turns:vieux-fil")).toBe(false);
  expect(store.has("turns:fil-1")).toBe(true);
});

for (const surface of ["terminal", "desktop"] as const) {
  test(`écart avec le temps hachuré ${surface}`, async ($, on) => {
    mock.clock(on, { now: NOW });
    mock.store(on);
    on("session.id", () => ({ value: "fil-1" }));
    on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
    on("ui.invalidate", () => ({ value: undefined }));
    on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
    const gaps = [
      // 5 h : 74 % consommés, fenêtre finie à 99 % : marge restante.
      { kind: "five_hour", percentUsed: 74, resetsAt: new Date(NOW + 3 * 60_000).toISOString() },
      // 7 j : 80 % consommés pour 57 % écoulés : avance sur le temps (alerte).
      { kind: "seven_day", percentUsed: 80, resetsAt: new Date(NOW + 3 * 86_400_000).toISOString() },
    ];
    on("session.usage", () => ({ value: { startedAt: NOW, context: { tokens: 107_000, window: 1_000_000, percent: 11 }, rateLimits: gaps } }));
    await $.session.start({ source: "startup", cwd: "/tmp" } as any);
    const ui = await $.ui.mount({ plugin: "token-weather-usage", surface, component: "AbovePrompt", props: { bodyColumns: 200 } as any });
    if (surface === "terminal") {
      const dashes = (await ui.findAll({ type: "Text", text: "╍" })) as any[];
      // 2 cases de marge grise (5 h), 1 case d'avance rouge (7 j).
      expect(dashes.filter((d) => d.props?.dimColor).length).toBe(2);
      expect(dashes.filter((d) => d.props?.color === "red").length).toBe(1);
    } else {
      const svgs = (await ui.findAll({ type: "Svg" })) as any[];
      const gauges = svgs.filter((s) => String(s.props?.alt ?? "").includes("consommés"));
      expect(gauges.length).toBe(2);
      for (const g of gauges) expect(String(g.props?.source)).toContain("<pattern");
      expect(svgs.some((s) => String(s.props?.source).includes("#4f8ef7"))).toBe(false);
    }
  });
}
