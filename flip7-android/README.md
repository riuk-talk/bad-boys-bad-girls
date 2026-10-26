# Flip 7 — Android

Version numérique non officielle du jeu de cartes Flip 7, pour un usage personnel.
Le jeu est en HTML/CSS/JavaScript (`app/src/main/assets/www/`) affiché dans une WebView Android
plein écran. Aucune connexion Internet n'est nécessaire.

## Installer sur le téléphone

1. Télécharger `dist/flip7.apk` sur le téléphone.
2. L'ouvrir et autoriser « l'installation d'applications inconnues » pour le navigateur ou le
   gestionnaire de fichiers quand Android le demande.

Toutes les versions sont signées avec la même clé (`keystore/flip7-shared.jks`, non secrète) :
une nouvelle version s'installe par-dessus l'ancienne sans perdre la partie en cours.
Avant toute diffusion publique, il faut une clé privée et un autre nom (« Flip 7 » est une marque).

## Illustrations des cartes

Les faces des cartes (`www/img/cards/`) sont extraites de la notice officielle française
(dessins vectoriels, voir `tools/`). Elles appartiennent à leurs auteurs : **usage personnel
uniquement**, ne pas publier l'APK ni rendre ce dépôt public avec ces images.
Le dos des cartes vient d'une photo d'une vraie carte (redressée, `tools/straighten_back.py`) ; le logo de l'accueil vient de la couverture de la notice (`tools/extract_logo.py`).

## Contenu

- `www/js/engine.js` : moteur des règles (paquet de 94 cartes, Gel, Tirer 3, Seconde chance,
  Flip 7, score, fin de partie). Sans DOM, testé sous Node.
- `www/js/ai.js` : IA à 4 niveaux (Débutant, Joueur, Stratège, Expert). Elle n'utilise que
  l'information publique : en Flip 7 toutes les cartes sont visibles, compter les cartes est permis.
- `www/js/ui.js` : écrans, rendu, animations, boucle de jeu, sauvegarde automatique.
- `www/js/audio.js`, `www/js/fx.js` : sons synthétisés (Web Audio) et particules (canvas).

## Commandes

```bash
node --test tests/*.test.js   # tests du moteur et de l'IA
./gradlew assembleRelease     # APK dans app/build/outputs/apk/release/
```

Il faut un JDK 17+ et le SDK Android (plateforme 35) ; indiquer son chemin dans
`local.properties` (`sdk.dir=…`) ou la variable `ANDROID_HOME`.
