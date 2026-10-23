---
name: lab
description: Ouvre une session Picodev Lab, un banc Arduino simulé dans le navigateur du visiteur -- choisit le montage (list_setups) et le décrit (read_setup), ouvre la session (open_session), donne le lien du banc et attend que le navigateur soit connecté. Use when the user types /lab or /picodev-lab:lab, presses Libre or Défi in the Lab pane, or asks to open the lab, an Arduino bench or a simulation on lab.picodev.fr.
argument-hint: "[setup] [libre|defi]"
---

# /lab : ouvrir une session

Le serveur MCP `picodev-lab` (lab.picodev.fr) ouvre un banc Arduino **simulé dans le navigateur
du visiteur**. Sans navigateur ouvert sur le banc, rien ne simule. Dites toujours « simulation »,
jamais « banc réel » : le banc réel, une vraie carte du labo, ne s'obtient que par sa file
(`queue_join`, onglet « Banc réel » du panneau).

## Le fichier de session

Après `open_session`, la session est gardée **hors du projet du visiteur**, dans le dossier de
données du plugin (mode 600), par ce script. C'est là que le hook d'écriture et le panneau la lisent.

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/lab.py" --data "${CLAUDE_PLUGIN_DATA}" --project "${CLAUDE_PROJECT_DIR}" show
```

Ci-dessous, `… show` désigne cette commande écrite en entier, `… save` et `… clear` la même avec
`save` ou `clear` à la place de `show`.

- `… show` : la session ouverte pour ce projet (JSON avec `agent_token`), ou une erreur s'il n'y en a pas.
- `… save` : enregistre ce que `open_session` a rendu (JSON sur l'entrée standard).
- `… clear` : l'oublie.

Règles : n'écrivez **jamais** `agent_token` dans un fichier du projet, ne l'affichez pas au
visiteur, ne le mettez pas dans un message de commit. Une erreur qui dit la session inconnue ou terminée (« unknown session »)
d'un outil : lancez `… clear` et proposez d'en ouvrir une autre.

## Déroulé

1. **Session déjà ouverte ?** Lancez `… show`. S'il y en a une, dites-le (montage, mode) et
   demandez : la reprendre (allez à l'étape 5) ou la terminer (`close_session`, puis `… clear`)
   et en ouvrir une autre.
2. **Montage.** Appelez `list_setups`. Un argument qui nomme un montage (`setup-a`) le choisit ;
   sinon, un seul montage disponible est pris d'office, plusieurs sont proposés au visiteur
   (titre et résumé). Ne proposez que ceux que `list_setups` rend.
   **Décrivez-le** avant d'ouvrir : `read_setup(id)` rend la fiche (`circuit` : composants et
   fils, `probes` : les voies de l'analyseur, `logic` ou `scope`) et l'image du montage. En
   quelques lignes : la carte, chaque composant et la broche où il est branché, les voies
   mesurées. L'image est aussi à `https://lab.picodev.fr/setups/<id>/schema.png` : donnez ce
   lien. Le texte en anglais de la fiche est sous `i18n.en`. Décrivez ce qui est branché, rien
   de plus : pas les `levels` et leurs `hints`, pas les seuils de `couplings`, pas ce qui cloche
   dans le sketch de départ. C'est ce que les niveaux font trouver au visiteur.
3. **Mode.** `libre` → `free`, `defi` ou `défi` → `challenge`, à prendre parmi les `modes` du
   montage. Sans argument, demandez : Libre (écrire ce qu'on veut) ou Défi (niveaux avec tests).
4. **Ouverture.** Appelez `open_session(setup, mode)`, puis enregistrez aussitôt la réponse :

   ```
   python3 "${CLAUDE_PLUGIN_ROOT}/scripts/lab.py" --data "${CLAUDE_PLUGIN_DATA}" --project "${CLAUDE_PROJECT_DIR}" save <<'EOF'
   {"session": "…", "agent_token": "…", "open_url": "…", "setup": "setup-a", "mode": "challenge"}
   EOF
   ```

5. **Le navigateur.** Donnez `open_url` au visiteur : « Ouvrez ce lien dans votre navigateur : la
   simulation y tourne. Ce lien vous est personnel ; pour montrer votre banc, utilisez
   /lab-partage. » Le panneau Lab a aussi un bouton « ouvrir le banc ».
6. **Attendre la connexion.** Demandez au visiteur de dire quand la page est ouverte, puis
   appelez `session_status(session, agent_token)` : `owner` vrai, le navigateur est connecté ;
   faux, redonnez le lien et attendez. Cet outil ne laisse pas de trace dans le journal du
   visiteur : c'est la vérification bon marché. Un labo qui ne l'a pas (outil inconnu) :
   `read_simulation`, `state` à `null` tant que le navigateur n'a rien publié. Puis
   `read_simulation` pour le code du banc (étape 7).
7. **Le sketch sur le poste.** `state.files` contient le code du banc. Proposez de l'écrire dans
   le projet, dans `sketch/` (un fichier par entrée, mêmes noms). N'écrasez jamais un fichier
   existant sans demander. Ensuite, chaque `Write` ou `Edit` d'un fichier du dossier du sketch
   (`.ino`, `.h`, `.cpp`, `.c`) est compilé et poussé dans le banc par le hook du plugin (voir
   « La compilation ») ; le visiteur le coupe avec /lab-push off.
8. **Dépôt git local** (une fois, le sketch écrit). Lancez `… git status sketch/` (même commande,
   `git status sketch/` au lieu de `show`). `in_repo` faux : proposez, en une phrase, un dépôt
   git local pour garder chaque version (« un commit après chaque envoi, sur votre poste, rien
   n'est envoyé à un hébergeur »). Oui : `… git init sketch/` (crée le dépôt et un `.gitignore`
   des sorties de compilation). Non : n'en reparlez pas. `in_repo` vrai (le projet du visiteur a
   déjà son dépôt) : rien à proposer, le plugin n'y commite pas. Le panneau a aussi un bouton.
9. **La suite**, en une phrase : en Défi, /lab-defi lance la boucle des niveaux ; en Libre,
   /lab-montage change le circuit ; /lab-partage
   règle qui peut regarder ; la session se ferme seule après 10 minutes sans navigateur ou 4 heures.

## La compilation : sur le poste d'abord

Le hook compile le sketch **sur le poste du visiteur** avec `arduino-cli` (la carte et les
bibliothèques viennent de `read_setup` : `board.fqbn`, `libraries`) et envoie le programme
(`push_program`) : c'est plus rapide et ça ne dépend pas du labo. Sans `arduino-cli`, ou sans le
cœur ou une bibliothèque qu'il n'a pas pu installer, le labo compile à sa place (`push_to_editor`,
le repli). Le message du hook dit toujours le chemin : « compilé sur votre poste » ou « compilé par
le labo ». Une erreur du code n'est pas un repli : rien n'est envoyé, le hook vous donne les
erreurs du compilateur, corrigez le sketch.

**Une fois par session, à l'étape 2** : `arduino-cli version`. Introuvable : dites que le labo
compilera (un peu plus lent) et proposez, sans insister, de l'installer :
https://docs.arduino.cc/arduino-cli/installation/ . Présent : `arduino-cli core list` doit
contenir le cœur de la carte (les deux premiers champs de `board.fqbn`, par exemple
`arduino:avr`) ; sinon proposez `arduino-cli core update-index && arduino-cli core install
arduino:avr` (quelques minutes la première fois). Le hook essaie aussi une fois par session
d'installer le cœur ou les bibliothèques qui manquent. N'installez rien sans l'accord du visiteur.
Un `arduino-cli` hors du `PATH` : la variable `PICODEV_ARDUINO_CLI` donne son chemin.

## Limites du labo

8 fichiers et 64 Kio au plus par envoi, un programme de 48 Kio au plus (texte HEX) ; 10 sessions par minute et par adresse. Les noms de
fichiers : lettres, chiffres, `.`, `_`, `-`.
