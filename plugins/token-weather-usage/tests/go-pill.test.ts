import { test, expect, mock } from "claude-code/testing";
// @ts-ignore: the module is plain JavaScript.
import { goList, goMessage } from "../hooks/token-weather-usage.mjs";

const NOW = Date.UTC(2026, 9, 2, 13, 0);

const ANSWER = `Ce qui attend ton oui
- « GO commit calendrier, attente et notifications ClimaDay » : tout sauf le rapport.
- « GO push origin main ClimaDay »
- « Go TestFlight 1.0 (6) ClimaDay » : build passé à 6.
Rappel : « GO push origin main ClimaDay ». Pas un GO : « gonflé », « ok ».`;

test("goList: the GOs between French quotes, in order, once each", () => {
  expect(goList(ANSWER)).toEqual([
    "GO commit calendrier, attente et notifications ClimaDay",
    "GO push origin main ClimaDay",
    "Go TestFlight 1.0 (6) ClimaDay",
  ]);
  expect(goList("« GO push 3.17.1 »")).toEqual(["GO push 3.17.1"]);
  expect(goList("Rien à valider.")).toEqual([]);
  expect(goList("GO sans guillemets, « GOOD », « gouffre »")).toEqual([]);
  // Other quotes, in order of appearance; "GO" in capitals there, so code stays out.
  expect(goList('Next: “GO deploy staging”, then "GO merge #12" and `GO commit`. Not `go test ./...` nor "Go home".')).toEqual(["GO deploy staging", "GO merge #12", "GO commit"]);
});

test("goMessage: the authorization quotes every GO it covers", () => {
  expect(goMessage(["GO a", "GO b"])).toBe("You have my approval for all the GOs: “GO a”, “GO b”");
});

// What the engine answers beneath the plugin in these tests.
function base(on: any) {
  mock.clock(on, { now: NOW });
  mock.store(on, {});
  mock.env(on, {});
  on("session.id", () => ({ value: "session-1" }));
  on("session.start", (_$: any, e: any) => ({ cwd: e.cwd ?? "/tmp" }));
  on("ui.invalidate", () => ({ value: undefined }));
  on("session.usage", () => ({ value: { startedAt: NOW, context: { tokens: 107_000, window: 1_000_000, percent: 11 }, rateLimits: [] } }));
}

// The band draws its own row; nothing beneath it.
function bandBeneath(on: any) {
  base(on);
  on("ui.render", ($: any, e: any) => $.ui.resolve(e).Box({ children: [] }));
}

async function answer($: any, text: string) {
  await $.turn.complete({ answer: text, reason: "answer", turnId: "t1", durationMs: 1, isAborted: false } as any);
}

test("desktop: the pill ends the band's row, and a click sends the GOs as Eric's words", async ($, on) => {
  bandBeneath(on);
  const sent: any[] = [];
  on("prompt.submit", (_$: any, e: any) => {
    sent.push(e);
    return { text: e.text };
  });
  on("turn.complete", () => ({ text: "" }));
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await answer($, ANSWER);
  const ui = await $.ui.mount({ plugin: "token-weather-usage", surface: "desktop", component: "AbovePrompt", props: {} as any });
  const rows = (await ui.findAll({ type: "Box" })) as any[];
  const row = rows.find((b) => b.props?.flexWrap === "wrap");
  const keys = (row.children as any[]).map((c) => c.props?.key ?? c.key);
  expect(keys[0]).toBe("context");
  expect(keys[keys.length - 1]).toBe("go-pill");
  const button: any = await ui.find({ type: "Button", key: "go-all" });
  expect(button.props?.label ?? button.label).toBe("OK");
  // Drawn: the count alone, bold.
  const count: any = await ui.find({ type: "Text", text: "3\u2009" });
  expect(count?.props?.bold).toBe(true);
  await ui.press({ key: "go-all" });
  expect(sent.length).toBe(1);
  expect(sent[0].text).toBe(goMessage(goList(ANSWER)));
  // Given once: the pill is gone until the next answer proposes GOs.
  const after = await $.ui.mount({ plugin: "token-weather-usage", surface: "desktop", component: "AbovePrompt", props: {} as any });
  expect(await after.findAll({ type: "Button" })).toEqual([]);
});

test("no GO in the answer, a new turn, or a subagent's answer: no pill", async ($, on) => {
  bandBeneath(on);
  on("turn.complete", () => ({ text: "" }));
  on("turn.step", async function* () {
    return { turnId: "t2", index: 0, answer: "", toolUses: [], stopReason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
  });
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  const buttons = async () => (await (await $.ui.mount({ plugin: "token-weather-usage", surface: "desktop", component: "AbovePrompt", props: {} as any })).findAll({ type: "Button" })) as any[];
  await answer($, "Fait, rien à valider.");
  expect(await buttons()).toEqual([]);
  await answer($, ANSWER);
  expect((await buttons()).length).toBe(1);
  await $.turn.complete({ answer: "« GO autre chose »", reason: "answer", turnId: "a1", agentId: "agent-1", durationMs: 1, isAborted: false } as any);
  expect((await buttons()).length).toBe(1);
  const stream = ($ as any).turn.step({ turnId: "t2", index: 0, model: "claude-opus-5-5", messageCount: 2 });
  for await (const _ of stream) {
  }
  expect(await buttons()).toEqual([]);
});

test("terminal: a plain button with the count", async ($, on) => {
  bandBeneath(on);
  on("turn.complete", () => ({ text: "" }));
  await $.session.start({ source: "startup", cwd: "/tmp" } as any);
  await answer($, ANSWER);
  const ui = await $.ui.mount({ plugin: "token-weather-usage", surface: "terminal", component: "AbovePrompt", props: {} as any });
  const button: any = await ui.find({ type: "Button", key: "go-all" });
  expect(button.props?.label ?? button.label).toBe("✓✓ 3 GO");
});
