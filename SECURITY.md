# Sécurité

## Signaler une faille

Écrivez à **contact@picodev.fr**, objet « Sécurité picodev-lab-plugin », ou ouvrez un
signalement privé dans l'onglet *Security* du dépôt (*Report a vulnerability*). Pas
d'issue publique, s'il vous plaît.

Dites-nous la version du plugin (`/plugin` dans Claude Code), ce que vous avez observé et
comment le reproduire. Nous accusons réception sous 5 jours ouvrés et vous tenons au
courant jusqu'au correctif, publié comme une nouvelle version. Nous vous citons dans les
notes de version si vous le souhaitez.

Une faille du labo lui-même (`lab.picodev.fr`) se signale à la même adresse.

## Ce que le plugin garde

* **Aucun secret dans le plugin.** Il ne contient ni clé ni jeton, et ne demande aucun
  compte. Le seul jeton est celui qu'une session du labo donne à votre agent : il est
  gardé dans le dossier de données du plugin, droits 600, jamais dans votre projet, et
  effacé à la fin de la session.
* Le plugin ne parle qu'à `https://lab.picodev.fr` et, pour l'avis de mise à jour, à ce
  dépôt sur GitHub (`git ls-remote`). Le détail : « Ce qui part, et où » dans
  `README.adoc`.
* Le labo ne lit jamais votre disque : le plugin envoie le contenu des fichiers du
  sketch, 8 fichiers et 64 Kio au plus.

## Versions suivies

La dernière version publiée seulement.
