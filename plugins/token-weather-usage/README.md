# Token Weather Usage

Une ligne au-dessus du prompt de Claude Code : la météo du contexte, les tokens, une barre par prompt, puis tes limites 5 h et 7 jours.

![La bande dans l'app de bureau](https://raw.githubusercontent.com/augiefra/claude-mods/main/docs/bande.png)

- **Météo du contexte** : de Clair à « Compacter bientôt », selon la part de la fenêtre de contexte utilisée. Icônes dessinées dans l'app, symboles Unicode dans le terminal.
- **Contexte** : pourcentage et tokens utilisés sur la fenêtre.
- **Tours** : une barre par prompt sur les 8 derniers, de hauteur égale aux tokens ajoutés ; le prompt actuel en couleur. Conservé après un redémarrage.
- **5h / 7j** : part consommée des limites du compte, en vert, jaune ou rouge selon le rythme. L'écart avec le temps écoulé est hachuré : en gris quand il reste de la marge, dans la couleur de la barre quand on consomme plus vite que le temps. Puis le temps restant et l'heure de remise à zéro (heure de Paris).

![Les hachures de l'écart avec le temps](https://raw.githubusercontent.com/augiefra/claude-mods/main/docs/jauges-hachures.png)

Dans le terminal :

```
☁ Nuageux │ 44 % contexte · 440k/1M │ tours ▃▆▂█▃▄▂▇ ▲ +8.4k │ 5h ━━━╍╍╍── 37 % · 2h22 → 18:20 │ 7j ━━━━╍─── 60 % · 2j23h
```

*English: a one-line band above the Claude Code prompt with context "weather", context tokens, per-prompt token bars, and your 5-hour and 7-day usage limits, where the gap with elapsed time is hatched. Labels are in French.*

## Confidentialité

Aucune donnée personnelle collectée, envoyée ni conservée, aucune requête réseau. Le mod lit les chiffres d'usage fournis par Claude Code et garde dans le stockage local du plugin la dernière mesure des limites et, par fil, les derniers relevés de contexte (effacés après 8 jours d'inactivité).

## Crédits et licence

Météo, contexte et graphique des tours d'après l'exemple **Token Weather** d'Anthropic ([claude-code-playground](https://github.com/anthropics/claude-code-playground), Apache-2.0). Jauges de limites écrites d'après **usage-meter** de HolyGrail ([HolyGrail/claude-mods](https://github.com/HolyGrail/claude-mods/tree/main/plugins/usage-meter)), sans copie de son code. Licence Apache-2.0 : voir [LICENSE](https://github.com/augiefra/claude-mods/blob/main/LICENSE) et [NOTICE](https://github.com/augiefra/claude-mods/blob/main/NOTICE).
