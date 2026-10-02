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
    on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
    on("ui.invalidate", () => ({ value: undefined }));
    on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
    on("turn.complete", () => ({ text: "" }));
    const fills = [13, 44];
    let call = 0;
    on("session.usage", () => {
      const percent = fills[Math.min(call++, fills.length - 1)];
      return { value: { startedAt: NOW, context: { tokens: percent * 10_000, window: 1_000_000, percent }, rateLimits: LIMITS } };
    });
    await $.session.start({ source: "startup", cwd: "/tmp" } as any);
    await ($ as any).turn.complete({ answer: "ok" } as any);
    const ui = await $.ui.mount({ plugin: "token-weather-usage", surface, component: "AbovePrompt", props: { bodyColumns: 200 } as any });
    const texts = (await ui.findAll({ type: "Text" })).map((t: any) => t.text);
    expect(texts).toContain("tours");
    expect(texts).toContain("Nuageux");
    if (surface === "terminal") expect(texts).toContain("▂▄");
    else {
      const svgs = await ui.findAll({ type: "Svg" });
      expect(svgs.length).toBe(3);
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
