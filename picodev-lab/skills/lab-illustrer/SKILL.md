---
name: lab-illustrer
description: Dessine les illustrations de la spécification d'un projet électronique (spec-projet.md) -- synoptique, vue éclatée, forme ou mise en situation en plan axonométrique, couches -- en SVG au style de Picodev, les montre au visiteur et ne les garde que sur son accord, dans spec-figures/ avec leur ligne dans la rubrique. Adapté de diagram-design (Cathryn Lavery, MIT). Use when /lab-projet reaches its illustration step, or when the user asks to illustrate, draw or sketch their project for the spec ("illustrer ma spec", "dessine mon produit", "propose une forme").
---

# /lab-illustrer : les dessins de la spec

Adapté de diagram-design (Cathryn Lavery, licence MIT, `LICENSE` de ce dossier). Réduit à ce
qu'une spec demande, au style de Picodev, en SVG seulement.

## Ce qu'on dessine

Seulement ce que le visiteur a dit dans `spec-projet.md` ou en répondant. Ni cote, ni matériau, ni
composant, ni choix qu'il n'a pas donnés : une forme qu'il n'a pas décrite est une **proposition**
et sa légende le dit. Trois illustrations au plus par spec.

| Il faut montrer | Type | Référence | Rubrique |
|---|---|---|---|
| Les blocs du produit et ce qui circule entre eux (capteurs → microcontrôleur → sorties, alimentation) | synoptique | `references/synoptique.md` | `fonctions` |
| Les parties d'un objet et leur empilement (boîtier, carte, pile, capot) | vue éclatée | `references/eclate.md` | `format` |
| La forme proposée, ou le produit dans son lieu d'usage (mur, tableau, champ, véhicule) | plan axonométrique | `references/forme.md` | `format` ou `envelope` |
| Des niveaux ordonnés (couches logicielles, protocole) | couches | `references/couches.md` | `fonctions` ou `preferences` |

Avant d'écrire le SVG, lisez `references/primitives.md` (boîtes, flèches, textes, budget) et
`references/style.md` (palette, polices, ce que le PDF accepte).

## Le déroulé

1. **Proposer** : dites en une phrase ce que vous allez dessiner et d'après quoi (« le capteur, le
   Nano et l'écran, d'après « Modules et fonctions » »). Un seul dessin à la fois.
2. **Dessiner** : un fichier SVG autonome, `spec-figures/<nom>.svg` (`<nom>` en minuscules, sans
   espace : `synoptique`, `forme`, `situation`), à côté de `spec-projet.md`. 200 Kio au plus.
3. **Montrer** : ouvrez-le (navigateur, aperçu) ou donnez son chemin, et demandez : « Je la garde
   dans la spec ? » Proposez de la corriger s'il le faut.
4. **Garder seulement sur un oui explicite** : ajoutez sa ligne, seule, dans la rubrique qu'elle
   illustre de `spec-projet.md` :

   ```
   ![Synoptique : capteur, microcontrôleur, écran](spec-figures/synoptique.svg)
   ```

   La légende fait une ligne de 120 caractères au plus, dans la langue de la spec. Sur un non,
   effacez le fichier, ou refaites-le d'après ce qu'il dit.

Le PDF de Picodev imprime chaque figure dans sa rubrique, avec sa légende et la mention
« proposition illustrée, validée par le visiteur ».

## Vérifier avant de montrer

- Le fichier commence par `<svg` : pas de `<?xml … DOCTYPE`, pas de `<!ENTITY`.
- Ni `<script>`, ni `<foreignObject>`, ni `<image>`, ni `href` vers un fichier ou une URL (un
  `href="#id"` interne est permis) : le labo refuserait le dessin.
- `viewBox` présent, largeur 1000 ; `<title>` et `<desc>` en tête (référence `primitives.md`).
- Pas de texte coupé : comptez 0,6 em par caractère pour la largeur d'un libellé.
- Un seul élément en corail (deux au plus), le reste en marine et gris.
