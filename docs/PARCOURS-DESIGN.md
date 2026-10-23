# Parcours complet : décisions de design du porteur (2026-10-05)

> Validé par Chris le 2026-10-05. Maquettes (mobile 390 px, plus une Fiche grand écran) dans `docs/design/parcours/` : ce sont des fichiers d'un outil de design (styles en ligne). Reproduis **le rendu et les règles**, pas le code. Références visuelles du porteur : `docs/design/reference-dossier-judiciaire.jpg` (ancienne Fiche, **remplacée le 2026-10-23** par `FichePancarte.dc.html`, voir §2) et `docs/design/reference-parloir-ancienne.jpg` (ancienne piste néon, **abandonnée** au profit du style « cabine », voir §5).
> Ce document **complète et remplace** la SPEC sur les points ci-dessous. Mets à jour SPEC, CLAUDE.md (vocabulaire) et SCHEMA en conséquence.

## 1. Les couleurs désignent le genre, jamais le rôle

- **Or `#D4A437`** = homme, **rouge `#E0233F`** = femme, **crème `#F2E8D5`** = non-binaire ou autre. Quel que soit le rôle (Bad ou Visiteur).
- **L'interface** (boutons principaux, onglet actif, barre de progression) prend la couleur **de la personne connectée**.
- **Ce qui représente quelqu'un** (Fiche, carte de la Promenade, lettre du Courrier, bulle du Parloir, nom, tampon) prend la couleur **de la personne affichée**. Exemple : un Visiteur homme voit ses boutons en or et les Fiches des bad girls en rouge.
- **Le rôle se reconnaît autrement que par la couleur** :
  - une étiquette en haut de chaque écran connecté : **« BAD »** avec une icône de barreaux, **« VISITEUR »** avec une icône de combiné ;
  - les matières : le Bad = dossier papier, cellule ; le Visiteur = permis, vitre de parloir.
- **Page d'accueil (déjà en ligne)** : les deux portes passent en **crème** (cadre, halo, texte). La porte Bad garde ses barreaux et « CELLULE B », la porte Visiteur sa vitre, son hygiaphone et « PARLOIR ». Les autres éléments or/rouge de la landing qui opposaient Bad et Visiteur (sur-titres, titres de section côté Bad / côté Visiteur, blocs « CÔTÉ BAD » / « CÔTÉ VISITEUR ») passent aussi en crème. L'or et le rouge restent pour la marque (logo, « BAD BOYS & BAD GIRLS », tampons, bandeau).
- Contrastes AA inchangés : le rouge en petit texte sur fond sombre = `#EE3A55` ; sur papier crème = `#B5172E` ; l'or sur papier crème = `#765A0E` (5,33:1 ; `#8A6A12` ne faisait que 4,16:1, refusé par axe — validé par Chris le 2026-10-06).
- Le vert (exception §1 bis) reste réservé aux retours du jeu et aux statuts positifs (Bien vu, Le vrai, Visite acceptée, Casier vierge, Ouvert aux visites).

## 2. La Fiche du Bad = les 3 poses et la pancarte (décision du porteur, 2026-10-23)

Maquette : `docs/design/parcours/FichePancarte.dc.html`. Elle **remplace** la planche du dossier judiciaire (`reference-dossier-judiciaire.jpg`, `Fiche.dc.html`, `FicheLarge.dc.html`, mise en page de la 9d, vue miniature et plein écran comprises) : ces fichiers restent dans `docs/design/` pour mémoire, ils ne font plus foi.

- **Les 3 poses** détourées, côte à côte sur le mur gradué : profil gauche, **face au centre (plus large)**, profil droit. Tampon **« BONNE CONDUITE »** en haut à droite si le badge est acquis. Toucher une photo l'ouvre **en plein écran**, avec un balayage entre les 3 poses (flèches, bouton « Fermer », Échap).
- **La pancarte** : un panneau noir à lettres blanches, sur deux tiges, devant le bas des photos.
  - **Recto** : « Dossier judiciaire », **N° d'écrou**, **pseudo** (couleur du genre de la personne affichée), archétype · âge · quartier et distance, signes distinctifs, ce que la personne cherche, **note comportementale abrégée**, statut (« Ouvert aux visites » / « Parloir complet »), complices recrutés s'il y en a.
  - Le bouton **« Chefs d'accusation »** ne retourne **que la pancarte** (rotation 3D, coupée si l'utilisateur a demandé moins de mouvement).
  - **Verso** : les 3 chefs d'accusation, « 1 vrai · 2 faux ». Pour un Visiteur qui peut demander une visite : un **groupe radio** (fieldset + legend) pour parier. Sinon (sa propre Fiche, demande en cours…) : une simple liste.
- **La complicité** en haut, à côté du lien de retour.
- **Le pari** coché sur la pancarte est transmis à la **Demande de parloir**, qui s'ouvre avec ce choix (modifiable). Bouton **« Demander une visite · pari n° X »**. Sans pari : « Retourne la pancarte et parie pour demander ». Rien du pari n'est enregistré avant l'envoi de la demande (règle 14).
- **Le bouton suit l'état** : demande en cours = « Demande envoyée » (désactivé) ; « Parloir complet » (désactivé) ; visite acceptée, Permis permanent, Affaire classée en cours = explication ; Visiteur sans Permis délivré = explication ; blocage = la Fiche n'existe plus pour lui (404).
- **« Voir ma Fiche »** (Ma Fiche, Bad) : sa Fiche telle qu'un Visiteur la voit, verso consultable, sans pari ni bouton de demande.
- **Grand écran** : la même composition, agrandie et centrée (640 px au plus), pas de planche.
- **Cartes de la Promenade et de la Découverte** : la photo de face sur le mur, avec une **mini-pancarte** (pseudo, âge, quartier).
- **Prise de photo** (« Passe à la toise », photo du Permis) : un repère de cadrage montre la zone de la pancarte, consigne **« Visage et épaules dans le cadre »** (aussi dans le règlement du Greffe). L'aperçu détouré d'une pose montre la photo avec la pancarte.
- **Accessibilité** : la pancarte se lit comme du texte ; ordre de lecture photos → recto → verso (la face cachée est inerte) ; contraste AA (rouge `#FF5C74` sur le noir de la pancarte, 5,7:1).
- **Jamais affichés** (SPEC §5, non négociable) : date de naissance, prénom ou nom réel, taille.
- **N° d'écrou** : identifiant public **aléatoire** (ex. 4 à 6 chiffres, unique), jamais l'identifiant interne ni un compteur séquentiel (pas d'énumération des membres).

## 3. Alignement 3 poses obligatoire pour les Bads

- Étape 5 du Dossier renommée **« Passe à la toise »** (maquette `Photos.dc.html`) : 3 emplacements **Profil gauche / Face / Profil droit**, tous **obligatoires pour un Bad**. Le **Visiteur garde 1 seule photo de face** (Permis de visite).
- Positions en base : `0` = face (photo d'identité), `1` = profil gauche, `2` = profil droit ; photos supplémentaires à partir de `3`. `complete_onboarding()` exige les positions 0, 1 et 2 pour un Bad (0 seule pour un Visiteur). La Fiche n'apparaît nulle part tant que les **3** ne sont pas validées par le Greffe.
- Le Greffe valide chaque pose séparément (motif de refus par photo) ; règle affichée : visage visible, seul·e sur la photo, pas de lunettes de soleil sur la face, pas de nudité.
- L'ancienne option [P1] « Alignement 3 poses » de la SPEC §5 devient la norme ; la galerie classique ne sert plus que pour les photos 4 à 6.
- Un ancien Visiteur qui devient Bad doit compléter ses deux profils avant d'être visible.

## 4. Vocabulaire ajouté (CLAUDE.md, tableau du produit)

| Moment / concept | Nom dans le site |
|---|---|
| QCM | **L'Interrogatoire** (« INTERROGATOIRE · 3/10 ») |
| Présentation du Bad | **Note comportementale** |
| Bloc identité de la Fiche | **Identité du sujet** |
| Identifiant public de la Fiche | **N° d'écrou** |
| Agenda des visites | **Tableau des visites** |
| Écran de visite | **Parloir · Cabine n°** |
| Étape photos du Bad | **Passe à la toise** / **Photo signalétique** |
| Règles photo | **Le règlement du Greffe** ; bouton « Déposer au Greffe » |
| Liste des demandes du Visiteur | **Mes demandes de parloir** |

Inchangés et simples : Signaler, Bloquer, Conseils sécurité. Toujours interdits : match, swipe, like, juge.

## 5. Le Parloir : style « cabine », pas de néon

- En-tête = **plaque métal rivetée** « PARLOIR · CABINE 03 » avec un **hygiaphone** (cercle perforé), Signaler et Bloquer de chaque côté.
- Compteur « TEMPS DE VISITE 24:12 » dans un cadre sombre, badge du Visiteur (Casier vierge) à côté.
- Fond de conversation = **vitre** (reflets diagonaux très discrets).
- Bulles : contour 2 px dans la couleur du genre de l'auteur, nom en Special Elite majuscules ; pas de halo lumineux.
- Premier message = la fiche papier du pari (« LE PARI DE NOX », la ligne, tampon BIEN VU ! / RATÉ !), puis le mot du Visiteur.
- Parloir sans horaire (Permis permanent) : plaque « PARLOIR · SANS HORAIRE », carte de Cavale épinglée, deux boutons au-dessus du champ (Affaire classée / Proposer une Cavale), champ de saisie toujours visible.

## 6. Écrans maquettés (docs/design/parcours/)

| Fichier | Écran | Phase |
|---|---|---|
| `Photos.dc.html` | Bad · étape 5 · Passe à la toise | 3 |
| `Main.dc.html` | Bad · étape 6 · assistant du Casier | 3 |
| `QCM.dc.html` | Étape 8 · L'Interrogatoire (« Affiner » ouvert) | 3 |
| `Promenade.dc.html` | Visiteur · La Promenade 21:00 | 4 |
| `FichePancarte.dc.html` | Fiche d'un Bad : 3 poses et la pancarte (remplace les deux suivantes, 2026-10-23) | 9 |
| `Fiche.dc.html` / `FicheLarge.dc.html` | Ancienne Fiche (téléphone / grand écran), ne fait plus foi | 4 |
| `Demande.dc.html` | Demande de parloir (pari, mot, Souffleur) | 4 |
| `MesDemandes.dc.html` | Mes demandes de parloir + choix de l'heure | 4–5 |
| `Courrier.dc.html` | Bad · Le Courrier + Tableau des visites | 4 |
| `LireDemande.dc.html` | Bad · Permis du Visiteur, accepter / classer | 4 |
| `Heures.dc.html` | Bad · Heures de visite | 5 |
| `Visite.dc.html` | Parloir · visite de 30 min | 5 |
| `FinVisite.dc.html` | Fin de visite (Prolonger / Affaire classée) | 5 |
| `Permanent.dc.html` | Permis permanent + Cavale | 5 |

Les photos sont des silhouettes et les pseudos sont fictifs (maquette uniquement, jamais en production).
