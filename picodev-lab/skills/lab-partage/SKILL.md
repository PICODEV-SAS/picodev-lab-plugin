---
name: lab-partage
description: Règle la visibilité d'une session Picodev Lab (privée, lien, publique) et rend le lien spectateur ; en fin de défi ou de session, prépare le lien de partage /p/… et les liens LinkedIn et X. Use when the user types /lab-partage or /picodev-lab:lab-partage, or asks to share, show or stream their lab session or result.
argument-hint: "[privee|lien|publique]"
---

# /lab-partage : qui regarde, et le partage

Reprenez la session :

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/lab.py" --data "${CLAUDE_PLUGIN_DATA}" --project "${CLAUDE_PROJECT_DIR}" show
```

N'affichez jamais `agent_token` ni `open_url` comme lien à partager : `open_url` porte la clé du
navigateur du visiteur, il lui est personnel.

## Visibilité

`privee` → `private` (personne ne regarde), `lien` → `link` (qui a le lien), `publique` →
`public` (listée sur le site, « Regarder »). Sans argument, demandez. Prévenez : **changer la
visibilité coupe les spectateurs en place** (le lien change). Puis
`set_visibility(session, agent_token, visibility)` rend `viewer_url` (`null` en privée) : donnez-le.

Le visiteur veut seulement le lien actuel, sans rien changer : `session_status(session,
agent_token)` le rend (`viewer_url`) sans le renouveler, avec `visibility` et `viewers`
(spectateurs connectés).

## Partager un résultat

En fin de défi, ou quand le visiteur veut partager sa session :

1. `read_simulation` : niveaux réussis = `challenge.level`, plus 1 si tous les `results` du
   niveau sont `passed` (0 en Libre). Durée = maintenant moins `created_at` de `session_status`
   (secondes Unix ; à défaut, `opened_at` de la sortie de `show`), bornée à 86 400.
2. Lien : `<origine de open_url>/p/<setup>.<mode>.<niveaux>.<secondes>`, par exemple
   `https://lab.picodev.fr/p/setup-a.challenge.4.372` (`mode` : `free` ou `challenge`).
3. Proposez un texte, que le visiteur peut changer, par exemple : « J'ai réussi un défi Arduino
   en 6 min 12 s sur le banc simulé de Picodev Lab, piloté par mon agent. » Dites « simulé ».
4. Donnez le lien et les deux liens de publication, `T` le texte encodé, `U` le lien encodé
   (encodage URL) :
   - LinkedIn : `https://www.linkedin.com/sharing/share-offsite/?url=U`
   - X : `https://x.com/intent/post?text=T&url=U`

Rien n'est publié par vous : le visiteur ouvre le lien du réseau de son choix.

Une erreur qui dit la session inconnue ou terminée (« unknown session ») : `… clear` (même commande que `show`).
