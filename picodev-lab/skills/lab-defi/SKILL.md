---
name: lab-defi
description: Mène la boucle d'un défi Picodev Lab -- lit le montage (read_setup), la consigne et les tests du niveau (read_simulation), mesure (capture_logic, capture_analog), corrige le sketch, le pousse, relit, jusqu'au vert, sans jamais lire une solution. Use when the user types /lab-defi or /picodev-lab:lab-defi, presses "résoudre ce niveau avec Claude" in the Lab pane, or asks to solve, fix or pass the current level of a Picodev Lab challenge.
---

# /lab-defi : la boucle d'un défi

Il faut une session en mode Défi. Reprenez-la :

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/lab.py" --data "${CLAUDE_PLUGIN_DATA}" --project "${CLAUDE_PROJECT_DIR}" show
```

Pas de session : proposez /lab. Une session Libre : il n'y a pas de tests ; proposez d'en ouvrir
une en Défi. N'affichez jamais `agent_token`.

## Règles

- **Jamais de solution.** Ne cherchez pas, ne lisez pas, ne devinez pas une solution publiée
  (dépôts, site, pages web, dossiers `solutions/`). Vous travaillez avec la consigne, les
  résultats des tests et leurs mesures, le journal de compilation, les événements de la
  simulation, la fiche du montage et les captures. Les indices (`brief.hints`) se donnent **un par un, quand le
  visiteur en demande un**. `brief.hints` ne contient que les indices que le visiteur a dévoilés
  dans le banc : pour un indice de plus, demandez-lui d'en dévoiler un, ne le devinez pas.
- Les résultats sont ceux d'une **simulation** dans le navigateur : dites « en simulation ».
- Expliquez ce que vous changez et pourquoi, en peu de mots : le visiteur apprend.

## Boucle

0. Une fois par session : `read_setup(setup)` (le `setup` de `… show`). Le montage (`circuit`) et
   les voies mesurables (`probes`) disent quelle broche regarder ; l'image du montage aide à le
   voir. La fiche en dit plus que la consigne : ses `couplings` (seuils de la scène,
   par exemple l'angle où le bouton s'enfonce) et son `scene` aident à lire le montage. Ne vous en
   servez pas pour trouver la valeur à régler : mesurez (étape 5), essayez, relisez les tests.
1. `read_simulation(session, agent_token)`. `state` à `null` : le navigateur n'est pas connecté,
   redonnez `open_url` et attendez. Sinon, `challenge` donne `level` (indice à partir de 0 :
   affichez `level + 1`), `brief` (`title`, `brief`, `hints`) et `results`
   (`[{id, status, detail}]`, `status` : `pending`, `running`, `passed`, `failed`).
2. Montrez au visiteur : niveau, titre, consigne, chaque test ✓ / ✗ avec sa mesure (`detail`).
3. Lisez le sketch du projet (le dossier `sketch/`, ou celui que le visiteur indique). Corrigez-le
   avec `Edit` ou `Write`. Le hook du plugin le compile sur le poste (`arduino-cli`) et envoie le
   programme, ou le fait compiler par le labo quand la chaîne manque ; il dit par quel chemin, ou
   pourquoi il n'a rien pu envoyer (pas de navigateur, trop de fichiers). « Le sketch ne compile
   pas » : rien n'est parti, les erreurs du compilateur sont dans le message du hook ; corrigez,
   le hook repousse. Auto-push coupé : poussez avec
   `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/lab.py" --data "${CLAUDE_PLUGIN_DATA}" --project "${CLAUDE_PROJECT_DIR}" push sketch/`.
4. Relisez avec `read_simulation(since_ms=<le plus grand t des événements déjà lus>)` :
   - `compile.ok` faux : lisez `compile.log`, corrigez, repoussez (`compile.origin` : `agent`,
     le programme compilé sur le poste ; `cloud`, compilé par le labo) ;
   - des tests `pending` ou `running` : relisez un peu plus tard (une dizaine de fois au plus) ;
   - pour savoir sans bruit si la poussée a été compilée, ou si le navigateur est toujours là :
     `session_status(session, agent_token)` (pas d'entrée au journal du visiteur). `run` augmente
     à chaque compilation reçue ; il a changé : les temps des événements repartent de zéro,
     relisez avec `since_ms=0`. `level` sur `levels` : où en est le défi. `owner` faux : le
     navigateur est fermé, redonnez `open_url` ;
   - un test `failed` : partez de sa mesure (`detail`) et des événements (`events` :
     `{t, k, pin, v}`, `k` = `pin`, `pwm`, `servo` ou `serial`);
   - un test dont la fiche dit `"type": "answer"` se résout par
     `submit_answer(session, agent_token, test, value)` : dites au visiteur ce que vous proposez et
     pourquoi, une réponse par seconde ; le verdict s'affiche dans le banc et dans `results`.
5. **Mesurer avant et après.** Un problème de temps (rebond, période, rapport cyclique, délai) ou de
   tension : capturez plutôt que deviner, une fois avant la correction, une fois après, et comparez.
   - logique : `capture_logic(session, agent_token, pins?, duration_ms=1000)` (voies `logic` de la fiche) ;
   - tension, PWM, entrée analogique : `capture_analog(session, agent_token, pins?, duration_ms=1000,
     rate_hz=10000)`, 1 à 4 broches (D0-D13 = 0-13, A0-A7 = 14-21 ; par défaut les voies `scope`).

   Puis `read_capture(…, capture)` jusqu'à `state: ready`. Les mesures par voie d'abord
   (logique : `period_ms`, `duty`, `pulses` ; analogique : `min_v`, `max_v`, `mean_v`, `period_ms`),
   les fronts ou les échantillons seulement s'il le faut (`offset`, `next`). Une capture à la fois.
   `format="png"` (4 par minute) seulement quand une image aide le visiteur à voir ce que disent
   les nombres : montrez-la et dites ce qu'elle montre ; les nombres restent la référence.
6. Tous les tests verts : dites-le (« niveau n réussi, en simulation »). Le banc ne change pas de
   niveau seul. Ce n'est pas le dernier (`level + 1 < levels` de `session_status`) : si le visiteur
   a déjà dit de continuer, continuez, sinon demandez-lui une fois s'il veut le niveau suivant. Oui :
   `next_level(session, agent_token)` (comme le bouton « Niveau suivant » du banc ; il rend
   `{level, levels}`), puis relisez avec `read_simulation` jusqu'à ce que `challenge.level` soit le
   nouveau niveau, et reprenez la boucle à l'étape 2. Une erreur de `next_level` (« pas en Défi »,
   « tests du niveau pas tous réussis », « dernier niveau », pas de navigateur) : dites-la, relisez.
7. Le dernier niveau réussi : pas de `next_level`. Dites au visiteur de cliquer « Terminer » dans le
   banc, proposez /lab-partage (le lien de partage et les réseaux) et, en une phrase, « Et pour
   votre projet ? » : /lab-projet décrit le projet du visiteur pour Picodev.

Une erreur qui dit la session inconnue ou terminée (« unknown session ») : lancez `… clear` (même commande, `clear` au lieu
de `show`) et proposez /lab.
