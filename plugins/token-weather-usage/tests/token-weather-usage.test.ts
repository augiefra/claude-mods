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
    console.log(surface, JSON.stringify(texts));
    expect(texts).toContain("Clair");
    expect(texts).toContain("11 % contexte");
    expect(texts).toContain("5h");
    expect(texts).toContain("32 %");
    expect(texts).toContain("· 3h00 → 18:00");
    expect(texts).toContain("59 %");
    expect(texts).toContain("· 3j00h");
    // 5 h avant 7 j, quel que soit l'ordre reçu.
    expect(texts.indexOf("5h")).toBeLessThan(texts.indexOf("7j"));
  });
}
