---
name: lab-montage
description: Construit ou change le circuit d'une session Picodev Lab en mode Libre -- lit le circuit en place (read_simulation, read_setup), propose le changement au visiteur, l'envoie après son oui (push_circuit) et vérifie que l'éditeur l'a accepté. Use when the user types /lab-montage or /picodev-lab:lab-montage, or asks to add, remove or rewire a component, or to build a circuit, in a free-mode Picodev Lab session.
argument-hint: "[ce qu'il faut ajouter ou changer]"
---

# /lab-montage : changer le circuit (Libre)

Il faut une session en mode Libre, navigateur connecté. Reprenez-la :

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/lab.py" --data "${CLAUDE_PLUGIN_DATA}" --project "${CLAUDE_PROJECT_DIR}" show
```

Pas de session : proposez /lab libre. Une session Défi : le montage d'un niveau ne change pas ;
proposez d'en ouvrir une en Libre. N'affichez jamais `agent_token`.

## Déroulé

1. **Le circuit en place.** `read_simulation(session, agent_token)` : `state.circuit`
   (`{components, wires}`) est ce qu'il y a dans le navigateur ; `circuit_modified` dit s'il diffère
   de la fiche. `state` à `null` : redonnez `open_url` et attendez. `read_setup(setup)` donne le
   montage de départ et sa forme : partez des types (`wokwi-led`, `wokwi-resistor`…) et des noms
   de broches qu'elle utilise. La carte n'est pas un composant : les fils la désignent par son
   identifiant (`arduino-nano`) et ses broches écrites comme dans la fiche (`2`, `9`, `5V`, `GND`).
2. **Le changement, d'abord en mots.** Ce que le visiteur veut (l'argument, ou demandez). Écrivez
   le nouveau circuit **entier** : `push_circuit` remplace tout. Gardez ce qui ne change pas, avec
   les mêmes identifiants. Dites au visiteur, en peu de lignes : ce qui est ajouté, retiré,
   rebranché (composant, broche), et que la simulation s'arrête. Pas de `x`/`y` pour un nouveau
   composant : l'éditeur le place.
3. **Son oui.** N'envoyez rien avant. Le circuit qu'il a dessiné à la main est remplacé.
4. **Envoi.** `push_circuit(session, agent_token, components, wires)`. Limites : 40 composants,
   120 fils, 48 Kio ; identifiants `[A-Za-z0-9_.-]`, distincts ; 6 envois par minute.
5. **Vérifier.** `read_simulation` : `circuit_error` (texte de l'éditeur : type inconnu, broche
   inconnue) veut dire que rien n'a changé ; corrigez et redemandez. Sinon `state.circuit` est le
   nouveau circuit. La simulation est arrêtée : elle repart quand le sketch est repoussé. Le
   sketch doit suivre : proposez de l'adapter (le hook le pousse) ; sinon repoussez-le tel quel
   (`… push sketch/`, même commande, `push sketch/` au lieu de `show`).
6. Pour vérifier un branchement, simulation relancée : `capture_logic` ou `capture_analog` puis
   `read_capture`, comme dans /lab-defi.

Le circuit modifié n'a pas d'image : seule la fiche de départ en a une. Une erreur qui dit la
session inconnue ou terminée : `… clear` (même commande, `clear` au lieu de `show`), puis /lab.
