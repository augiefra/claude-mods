# Token Weather Usage

One line above the Claude Code prompt: your 5-hour and 7-day limits against the clock, the context weather, the tokens, and a bar per prompt.

![The band in the desktop app](https://raw.githubusercontent.com/augiefra/claude-mods/main/docs/band.png)

- **5h / 7d**: the share of your account's limits already used, in green, yellow or red by pace. The gap with the time elapsed is hatched: grey while you have margin, in the bar's color when you use faster than time passes. Then the time left and the reset time (machine's time zone).
- **Context weather**: from Clear to "Compact soon", by the share of the context window in use. Icons drawn in the app, Unicode symbols in the terminal.
- **Context**: percentage and tokens used out of the window.
- **Turns**: one bar per prompt for the last 8, as tall as the tokens it added; the current prompt in color. Kept across restarts.

![Hatching of the gap with elapsed time](https://raw.githubusercontent.com/augiefra/claude-mods/main/docs/gauges-hatching.png)

In the terminal:

```
☂ Showers │ 63% context · 634k/1M │ turns ▃▆▂█▃▄▂▆ ▲ +6.3k │ 5h ━━━━━━╍─ 74% · 24 min → 18:20 │ 7d ━━━━━─── 65% · 2d20h
```

Labels in English or French: `auto` follows `LC_ALL`, `LC_MESSAGES` or `LANG`, otherwise pick `en` or `fr` in the **Language** option (`/config`).

## Privacy

No personal data collected, sent or retained, no network requests. The mod reads the usage figures Claude Code provides and the locale variables, and keeps in the plugin's local storage the latest limits reading and, per session, recent context readings (deleted after 8 idle days).

## Credits and license

Weather, context and turns chart after Anthropic's **Token Weather** example ([claude-code-playground](https://github.com/anthropics/claude-code-playground), Apache-2.0). Limit gauges written after HolyGrail's **usage-meter** ([HolyGrail/claude-mods](https://github.com/HolyGrail/claude-mods/tree/main/plugins/usage-meter)), without copying its code. Apache-2.0 license: see [LICENSE](https://github.com/augiefra/claude-mods/blob/main/LICENSE) and [NOTICE](https://github.com/augiefra/claude-mods/blob/main/NOTICE).
