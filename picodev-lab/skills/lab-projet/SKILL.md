---
name: lab-projet
description: Aide le visiteur à décrire son projet électronique pour Picodev -- entretien mené par l'outil spec_draft du labo (rubrique suivante, ce qu'on cherche, questions), une question à la fois, écrit spec-projet.md sur son poste (dans un dossier dédié si le visiteur le veut), propose des illustrations à valider (skill lab-illustrer), aperçu du PDF, puis, seulement après un oui explicite, envoi de la spec (brief_submit) ou d'une demande de rendez-vous ou d'une question à Picodev (request_meeting). Use when the user types /lab-projet or /picodev-lab:lab-projet, presses "décrire mon projet", "envoyer la spec" or "rendez-vous / informations" in the Lab pane, or asks to describe their own project to Picodev, to meet Picodev, to ask Picodev a question ("poser une question à Picodev") or for information ("demander des informations").
---

# /lab-projet : décrire son projet, et l'envoyer à Picodev si on le veut

Picodev conçoit des cartes électroniques et leur logiciel. Ici, vous aidez le visiteur à décrire
**son** projet. Tout reste sur son poste **tant qu'il n'a pas dit oui à un envoi**. Commencez par
le dire : « Je vous pose quelques questions pour rédiger la spécification de votre projet. Elle
reste sur votre poste tant que vous n'avez pas choisi de l'envoyer. »

**Langue** : la spec s'écrit dans la langue des réponses du visiteur. Il répond en français :
tout en français (titres, texte, `language` `fr`, `--lang fr`), quel que soit l'outil. En
anglais : tout en anglais.

## L'espace de la spec

Avant la première question, s'il n'y a pas encore de `spec-projet.md`, proposez un dossier dédié
au projet (« Je crée un dossier pour votre spec ? Il contiendra la spec et ses illustrations. »)
et, sur un oui, avec le dossier qu'il choisit (par défaut `${CLAUDE_PROJECT_DIR}/mon-projet`) :

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/lab.py" workspace "<dossier>" --lang fr
```

(`python` à la place de `python3` sous Windows si `python3` manque.) Il crée `spec-projet.md` (le
squelette, à compléter d'abord par l'intitulé) et `spec-figures/`, sans rien écraser. La suite de
l'entretien se fait dans ce dossier. Sur un non, travaillez à la racine du projet, comme avant.

## Le fichier

`spec-projet.md`, dans l'espace de la spec, sinon à la racine du projet (`${CLAUDE_PROJECT_DIR}`).
Format fixe, que le plugin relit pour produire le PDF et pour le panneau :

```markdown
# <Intitulé du projet, une ligne, 120 caractères au plus>

## Contexte du projet
## Fonction principale
## Modules et fonctions
## Alimentation
## Format et encombrement
## Environnement
## Production
## Préférences techniques
## Coordonnées            (facultatif : seulement si le visiteur les veut dans le document)
```

Les titres restent ceux-ci, même pour un visiteur anglophone (le texte, lui, est dans sa langue).
Dans l'ordre, leurs `id` pour les outils : `envelope`, `fonctionPrincipale`, `fonctions`,
`alimentation`, `format`, `environnement`, `production`, `preferences`.
Sous chaque titre, un texte court en Markdown simple (4 000 caractères au plus), ou « À préciser ».
Un fichier qui existe déjà : reprenez-le là où il en est, ne l'écrasez pas. Une illustration
validée tient sur une ligne de sa rubrique : `![légende](spec-figures/<nom>.png)` (ou `.svg`).

## L'entretien

Les étapes et les questions sont celles de Picodev, servies par l'outil `spec_draft` du MCP ; c'est
vous qui posez les questions. `spec_draft` n'envoie rien et ne garde rien.

1. Appelez `spec_draft(sections, language)` : `sections` les rubriques de `spec-projet.md` déjà
   écrites, `{id: texte}` (aucune au début ; une rubrique « À préciser » n'en est pas une),
   `language` celle du visiteur (`fr` ou `en`).
2. Suivez ses `rules` : elles font foi sur la manière de mener l'entretien.
3. Posez **une question à la fois** sur la rubrique `next`, à partir de son `look_for` et de ses
   `questions`, dans la langue du visiteur. Reformulez sans inventer. Il ne sait pas : proposez
   deux ou trois options concrètes, chacune avec son compromis en quelques mots, et laissez-le
   choisir ; écrivez « Non tranché par le visiteur ; option proposée jugée acceptable : … ». Il
   n'en choisit aucune : la rubrique reste « À préciser ».
4. Mettez à jour la rubrique dans `spec-projet.md` (`Edit`), puis rappelez `spec_draft` avec les
   rubriques à jour, et ainsi de suite.
5. `ready` : les quatre rubriques requises sont remplies, assez pour que Picodev commence. Dites
   ce qui reste ouvert (les rubriques dont `state` n'est pas `filled`) et proposez la suite :
   continuer, l'aperçu du PDF, ou **l'envoi de la spec à Picodev (contact@picodev.fr)**, par la
   partie « Envoyer la spec » ci-dessous. `next` à `null` : tout est rempli, proposez l'envoi.

## Illustrations (seulement après un oui)

Une fois les quatre rubriques requises remplies (`ready`), proposez d'aller plus loin avec des
dessins : « Voulez-vous que je propose des illustrations pour la spec : votre produit en situation,
une proposition de forme, un synoptique ? Je vous les montre, vous choisissez. » Sur un oui, suivez
la skill `lab-illustrer` de ce plugin : un dessin à la fois, en SVG dans `spec-figures/`, montré au
visiteur, gardé **seulement sur son oui** par une ligne `![légende](spec-figures/<nom>.svg)` dans la
rubrique qu'il illustre. Trois au plus ; rien que le visiteur n'a pas dit (ni cote ni choix). Le PDF
les marque « proposition illustrée, validée par le visiteur ».

## Coordonnées dans le document

Avant l'aperçu du PDF, demandez : « Voulez-vous que vos coordonnées figurent dans le document,
pour que Picodev puisse vous joindre ? » Sur un oui, écrivez-les (nom, société, e-mail, téléphone,
ce qu'il donne) sous `## Coordonnées` ; sinon, pas de rubrique. Elles ne comptent pas dans
l'avancement. Elles sont distinctes de celles que demande l'envoi.

## Aperçu du PDF

Le PDF est produit par le labo (`spec_draft` avec `pdf=true`), au gabarit de Picodev Lab, avec la
mention « Rédigé avec l'assistance d'une IA ; relu par nos ingénieurs avant toute réponse ». Un
aperçu n'envoie rien. Passez par le script, qui écrit le PDF sur le poste (`--lang en` pour un
visiteur anglophone) :

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/lab.py" --data "${CLAUDE_PLUGIN_DATA}" --project "${CLAUDE_PROJECT_DIR}" brief spec-projet.md --lang fr
```

Il écrit `spec-projet.pdf` à côté et affiche `missing` (rubriques pas encore remplies), `next`,
`ready`, les illustrations envoyées (`figures`) et `contact_in_pdf`. Sans `--lang`, la langue est
celle des titres du fichier. Une illustration hors du dossier de la spec, trop lourde, ni PNG ni SVG
est refusée et rien ne part : dites-le au visiteur. Dites où est le PDF et ce qui manque. « Cannot make the PDF for now » : le labo ne peut
pas le produire pour l'instant, rien n'est parti ; proposez de réessayer plus tard.

## Envoyer la spec (seulement après un oui)

1. Demandez les coordonnées : nom et e-mail (exigés), société et téléphone (facultatifs).
2. Demandez s'il veut un **accord de confidentialité** (NDA) avant de transmettre son projet. Avec
   NDA, seuls ses coordonnées, l'intitulé et « NDA souhaité » partent ; la spec reste sur son poste.
3. Montrez **tout** ce qui partira : l'intitulé, les coordonnées, et la spec (ou « NDA souhaité,
   la spec reste sur votre poste »). Puis le **texte de consentement**, mot pour mot, tel que
   l'écrit la description de l'outil `brief_submit` du MCP (elle fait foi) : la version française
   ou anglaise, celle de la langue du visiteur. Ne le reformulez pas, ne l'abrégez pas.

4. Demandez : « Voulez-vous l'envoyer à Picodev ? » **N'envoyez que sur un oui explicite**, donné
   après avoir vu ce texte. Un silence, un « peut-être », un oui à autre chose n'est pas un oui.
5. Envoi (ajoutez `--nda` avec NDA ; `--company`, `--phone` s'il les a donnés ; `--with-session`
   s'il veut que Picodev sache ce qu'il a fait au labo ; `--lang en` pour un visiteur anglophone) :

   ```
   python3 "${CLAUDE_PLUGIN_ROOT}/scripts/lab.py" --data "${CLAUDE_PLUGIN_DATA}" --project "${CLAUDE_PROJECT_DIR}" brief spec-projet.md --send --consent --name "…" --email "…" --lang fr
   ```

6. Rapportez `sent` et `next` tels quels. Une erreur (503, 429, « Cannot send ») : dites-la, et
   proposez au visiteur d'envoyer lui-même le PDF (`spec-projet.pdf`) à contact@picodev.fr par
   courriel. Ne réessayez pas sans le lui demander.

## Rendez-vous / informations (seulement après un oui)

`request_meeting` sert à demander un rendez-vous **ou** à poser une question à Picodev.

1. Rédigez `context` (2 000 caractères au plus) : pour un rendez-vous, le projet en quelques
   phrases (ce qu'il veut faire, où il en est, ce qu'il a fait au labo), à partir de
   `spec-projet.md` s'il existe ; pour une question, **la question du visiteur**, telle qu'il la
   pose, avec ce qu'il faut de contexte pour y répondre.
2. Demandez ses disponibilités : des créneaux (dates et heures avec fuseau, dans les 60 prochains
   jours, 10 au plus) ou une phrase (« les mardis matin »). Pour une simple question, une phrase
   suffit (« une réponse par e-mail me suffit »). Et ses coordonnées (nom, e-mail).
3. Montrez la demande entière, puis le texte de consentement de la description de
   `request_meeting`, mot pour mot, dans la langue du visiteur, et demandez :
   « Voulez-vous envoyer cette demande à Picodev ? »
4. Sur un oui explicite seulement : `request_meeting(contact, context, availabilities,
   consent=true)` (`availabilities` : `[{from, to}, …]` ou `{text}`). Ajoutez `session` et
   `agent_token` (sortie de `… show`) s'il veut que Picodev voie ce qu'il a fait au labo.
5. Rapportez `next` : Picodev répond par e-mail (pour confirmer un créneau, ou à la question).

## Ce qui ne change pas

- Rien n'est envoyé sans ce oui. Le labo ne garde rien ; il n'écrit jamais à l'adresse du visiteur.
- Liens utiles : https://picodev.fr, https://lab.picodev.fr.
