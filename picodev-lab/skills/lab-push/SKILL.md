---
name: lab-push
description: Active ou coupe l'auto-push de Picodev Lab, le hook qui pousse le sketch dans le banc du navigateur après chaque Write ou Edit. Use when the user types /lab-push or /picodev-lab:lab-push, or asks to stop or resume pushing their sketch to the lab automatically.
argument-hint: "on|off"
---

# /lab-push on|off

Lancez, avec `on` ou `off` selon l'argument (sans argument, demandez) :

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/lab.py" --data "${CLAUDE_PLUGIN_DATA}" --project "${CLAUDE_PROJECT_DIR}" autopush on
```

Puis dites ce qui change, en une phrase : avec `on`, chaque `Write` ou `Edit` d'un `.ino`, `.h`,
`.cpp` ou `.c` d'un dossier de sketch est compilé et poussé dans le banc ; avec `off`, rien ne part
tout seul, et un envoi se fait avec `… push sketch/` (même commande, `push` au lieu de `autopush`).
Le réglage vaut pour tous les projets.

Un envoi compile d'abord sur le poste (`arduino-cli`, programme envoyé par `push_program`) ; sans
la chaîne de compilation, le labo compile (`push_to_editor`). Le message dit lequel : « compilé sur
votre poste » ou « compilé par le labo ». Le sketch ne compile pas : rien ne part, les erreurs du
compilateur sont dans le message, corrigez-les. Avec le dépôt git local (`… git init`, voir /lab),
chaque envoi réussi fait un commit sur le poste.
