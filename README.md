# claude-mods

Mods pour [Claude Code](https://claude.dev/blog/getting-started-with-claude-code-mods/), par Eric Cologni.

## token-weather-usage

Une ligne au-dessus du prompt, dans le terminal comme dans l'app de bureau :

```
☀ Clair │ 11 % contexte · 107k/1M │ tours ▁▃█ ▲ +12.4k │ 5h ━━━┃──── 32 % · 3h00 → 18:00 │ 7j ━━━━┃─── 59 % · 3j00h
```

- **Météo du contexte** : de Clair à « Compacter bientôt », selon la part de la fenêtre de contexte utilisée.
- **Contexte** : pourcentage et tokens utilisés sur la fenêtre.
- **Tours** : un mini-graphique des derniers tours et l'écart avec le précédent.
- **5h / 7j** : part consommée des limites du compte. Le trait bleu marque le temps écoulé de la fenêtre.
  Vert tant que la consommation ne va pas plus vite que le temps ; jaune au-delà ; rouge à plus de 15 points d'avance ou à partir de 90 %.
  Puis le temps restant, et pour la limite 5 h l'heure de remise à zéro (heure de Paris).
  La dernière mesure est partagée entre les sessions ouvertes sur la machine.

Les jauges sont dessinées en SVG dans l'app de bureau et en caractères dans le terminal ; elles disparaissent si la ligne ne tient pas.

*English: a one-line band above the prompt with context "weather", context tokens, a recent-turns chart, and your 5-hour and 7-day usage limits with elapsed-time markers. Labels are in French.*

### Installer

```
/plugin marketplace add augiefra/claude-mods
/plugin install token-weather-usage@augiefra-mods
/reload-plugins
```

Si la ligne n'apparaît pas, redémarrer Claude Code. Un mod est du code qui tourne dans Claude Code avec les mêmes accès que lui : relisez-le avant de l'installer.

### Vérifier

```
claude plugin validate ./plugins/token-weather-usage
claude plugin test ./plugins/token-weather-usage
```

## Crédits

- La météo du contexte, les tokens et le graphique des tours viennent de l'exemple **Token Weather** d'Anthropic ([claude-code-playground](https://github.com/anthropics/claude-code-playground), Apache-2.0).
- Les jauges de limites s'inspirent de **usage-meter** de HolyGrail ([HolyGrail/claude-mods](https://github.com/HolyGrail/claude-mods/tree/main/plugins/usage-meter)). Elles ont été réécrites pour ce mod ; aucun code d'usage-meter n'est inclus.

## Licence

Apache-2.0, voir [LICENSE](LICENSE) et [NOTICE](NOTICE).
