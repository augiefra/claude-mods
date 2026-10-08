# Token Weather Usage

One band above the Claude Code prompt: the context in tokens, your 5-hour and 7-day limits against the clock, whether the prompt cache is still warm, what the session and the last prompt cost, and which agents are running.

![One session, step by step](https://raw.githubusercontent.com/augiefra/claude-mods/main/docs/band-story.gif)

![All clear](https://raw.githubusercontent.com/augiefra/claude-mods/main/docs/situations/calm.png)

![Agents at work](https://raw.githubusercontent.com/augiefra/claude-mods/main/docs/situations/agents.png)

![Cache about to lapse](https://raw.githubusercontent.com/augiefra/claude-mods/main/docs/situations/soon.png)

![Slow down](https://raw.githubusercontent.com/augiefra/claude-mods/main/docs/situations/alert.png)

- **Context**: tokens in the context with a weather icon (hover the pill for the weather and the share of the window), one bar per recent prompt, the last prompt's change.
- **5h / 7d**: the share of your account's limits already used, in green, yellow or red by pace. The gap with the time elapsed is hatched: grey while you have margin, in the bar's color when you use faster than time passes. Then the time left; in the app, hover the 5-hour pill for the reset time (machine's time zone).
- **Cache**: the time before the prompt cache lapses (1 hour on a subscription, 5 minutes on an API key, inferred), behind a bolt in the app. The share of the last message read from the cache shows only under 90%. Yellow under 10 minutes, with what is at stake ("$2.32 at stake"); "missed" with its cause and what it cost above a hit ("+$2.10"); red "expired" with the cost of writing the context again ("289k to rewrite ≈ $2.32"), and the way out from 100k tokens: `/compact`, or a new thread from 300k (on the line in the terminal, in the hover card in the app). In the app, hover the cache pill for the expiry time, the share read, what the context costs a message from the cache against writing it again, and what the cache saved in this thread. The dollars come from Anthropic's list prices (dated 2026-10-08); on a subscription they are API-price equivalents, hence the "≈". A model missing from the price table shows tokens only. After a compaction the band updates at once: the context drops, and the cache reads "compacted" until the next message writes a new one.
- **Cost**: the session cost as `/cost` totals it (whole dollars from $100), and what the last prompt added, in dollars and in points of the 5-hour limit (in the pill's hover card in the app). On a subscription, an API-price equivalent, not a bill.
- **Agents**: how many subagents the thread ran ("2 running · 7" while some run). In the app the pill stays; hover it for the cost split by model and effort, the agents running and what delegating saved.

In the terminal:

```
☂ 634k ▃▄▂█▆ ▲ +6.3k │ 5h ━━━━╍─ 74% · 24 min │ 7d ━━━━── 65% · 2d20h │ cache 52 min │ ≈ $41.07 (+$0.58 · +1.5% 5h) │ 2 agents
```

Labels in English or French: `auto` follows `LC_ALL`, `LC_MESSAGES` or `LANG`, otherwise pick `en` or `fr` in the **Language** option (`/config`).

## Privacy

No personal data collected, sent or retained, no network requests. The mod reads the usage figures Claude Code provides (context, limits, session cost, each request's cache token counts), the list of the session's subagents, the locale variables and the prompt-cache switches, and keeps in the plugin's local storage the latest limits reading and, per session, recent context readings, the last request's cache figures, what the cache saved in the session, the last prompt's cost and each subagent's model, effort, token counts and description (deleted after 8 idle days).

## Credits and license

Weather, context and turns chart after Anthropic's **Token Weather** example ([claude-code-playground](https://github.com/anthropics/claude-code-playground), Apache-2.0). Limit gauges written after HolyGrail's **usage-meter** ([HolyGrail/claude-mods](https://github.com/HolyGrail/claude-mods/tree/main/plugins/usage-meter)), and the cache block after Daniel San's **prompt-cache-control** ([davila7/claude-code-templates](https://github.com/davila7/claude-code-templates), MIT), without copying their code. Apache-2.0 license: see [LICENSE](https://github.com/augiefra/claude-mods/blob/main/LICENSE) and [NOTICE](https://github.com/augiefra/claude-mods/blob/main/NOTICE).
