# claude-mods

Mods pour [Claude Code](https://claude.dev/blog/getting-started-with-claude-code-mods/), par Eric Cologni.

## token-weather-usage

Une ligne au-dessus du prompt, dans le terminal comme dans l'app de bureau :

```
☁ Nuageux │ 44 % contexte · 440k/1M │ tours ▂▂▃▃▄▄ ▲ +698 │ 5h ━━━┃──── 37 % · 2h22 → 18:20 │ 7j ━━━━┃─── 60 % · 2j23h
```

- **Météo du contexte** : de Clair à « Compacter bientôt », selon la part de la fenêtre de contexte utilisée.
- **Contexte** : pourcentage et tokens utilisés sur la fenêtre.
- **Tours** : le remplissage du contexte sur les derniers tours (échelle 0 à 100 %), et l'écart avec le tour précédent. Affiché à partir du deuxième tour.
- **5h / 7j** : part consommée des limites du compte. Le trait bleu marque le temps écoulé de la fenêtre.
  Vert tant que la consommation ne va pas plus vite que le temps ; jaune au-delà ; rouge à plus de 15 points d'avance ou à partir de 90 %.
  Le pourcentage reste dans la couleur du texte, en rouge seulement en alerte. Puis le temps restant, et pour la limite 5 h l'heure de remise à zéro (heure de Paris).
  Une fenêtre déjà remise à zéro est masquée jusqu'à la mesure suivante.
  La dernière mesure est partagée entre les sessions ouvertes sur la machine.

Jauges et courbe sont dessinées en SVG dans l'app de bureau et en caractères dans le terminal. Si la ligne ne tient pas dans le terminal, les barres et le détail s'effacent ; il reste le libellé et le pourcentage.

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

## Confidentialité

token-weather-usage ne collecte, n'envoie ni ne conserve aucune donnée personnelle. Il lit seulement les chiffres d'usage que Claude Code lui fournit (remplissage du contexte, limites 5 h et 7 jours) et garde la dernière mesure des limites dans le stockage local du plugin, sur la machine. Aucune requête réseau.

*Privacy: the mod collects, sends and retains no personal data. It only reads the usage figures Claude Code provides and keeps the latest limits reading in the plugin's local storage. No network requests.*

## Crédits

- La météo du contexte, les tokens et le graphique des tours viennent de l'exemple **Token Weather** d'Anthropic ([claude-code-playground](https://github.com/anthropics/claude-code-playground), Apache-2.0).
- Les jauges de limites s'inspirent de **usage-meter** de HolyGrail ([HolyGrail/claude-mods](https://github.com/HolyGrail/claude-mods/tree/main/plugins/usage-meter)). Elles ont été écrites pour ce mod d'après usage-meter (même idée : jauges avec repère du temps écoulé, mesure partagée entre sessions), sans copie de son code.

## Licence

Apache-2.0, voir [LICENSE](LICENSE) et [NOTICE](NOTICE).
