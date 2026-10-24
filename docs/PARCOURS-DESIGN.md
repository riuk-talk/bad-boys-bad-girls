# Parcours complet : décisions de design du porteur (2026-10-05)

> Validé par Chris le 2026-10-05. Maquettes (mobile 390 px, plus une Fiche grand écran) dans `docs/design/parcours/` : ce sont des fichiers d'un outil de design (styles en ligne). Reproduis **le rendu et les règles**, pas le code. Références visuelles du porteur : `docs/design/reference-dossier-judiciaire.jpg` (ancienne Fiche, remplacée par `FichePancarte.dc.html` le 2026-10-23 puis par `FicheShow.dc.html` le 2026-10-24, voir §2) et `docs/design/reference-parloir-ancienne.jpg` (ancienne piste néon, **abandonnée** au profit du style « cabine », voir §5).
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

## 2. La Fiche du Bad = la Fiche v7 (décision du porteur, 2026-10-24)

Maquette : `docs/design/parcours/FicheShow.dc.html`, textures `docs/design/parcours/img/*.webp` (copiées dans `public/brand/textures/`). Elle **remplace** la Fiche « pancarte » de la 9g (`FichePancarte.dc.html`) et la planche du dossier judiciaire (`reference-dossier-judiciaire.jpg`, `Fiche.dc.html`, `FicheLarge.dc.html`), conservées pour mémoire.

- **Le mur** (`mur-toise.webp`, mur commun de tout le site, remplace `mur-toise.svg`) occupe l'écran de l'en-tête au pied de page, avec la toise chiffrée en code à droite.
- **Les 3 poses** ont la même taille (300 × 390 sur 390 px de large) ; celle du centre est devant et chevauche les deux autres, assombries. Les silhouettes détourées remplissent leur cadre : recadrage automatique (lu dans la transparence), ancrées en bas, la tête près du haut.
- **Glissement** : les cadres ne bougent jamais, seules les images changent, en fondu enchaîné avec un léger flou (0,8 s), en boucle dans les deux sens ; seuil 40 px, `touch-action: pan-y`. Toucher une pose de côté la met au centre. Aucune flèche, aucun point. Moins de mouvement demandé : changement sans animation.
- **Habillage dossier** : bandeau papier « DOSSIER JUDICIAIRE · PHOTO SIGNALÉTIQUE · ALIGNEMENT 3 POSES » avec trombone et ruban adhésif (sprite `accessoires.webp`) ; tampon « BONNE CONDUITE » (`tampon.webp`, texte en code) si le badge est acquis ; pied de page papier : code-barres, « DOSSIER N° {écrou} · PAGE 1/1 · QUARTIER : {ville} », trace de café à 45 %.
- **La pancarte** : petite, cadre de bois (`cadre-pancarte.webp` en `border-image`) et fond de feutre, sous le menton de la pose du centre, lisible sans être ouverte (pseudo, âge · ville · distance, signes, N° d'écrou, « Agrandir »). Au toucher, elle s'agrandit sur le bas de l'écran ; les têtes restent visibles, pas de voile, le glissement marche toujours. Recto : signes distinctifs, cherche, points communs, note comportementale (en entier), « Retourner : chefs d'accusation ». Verso (papier) : les 3 chefs d'accusation en boutons radio et « Valider mon pari » (désactivé sans choix). « Réduire » (44 px) sur les deux faces, Échap. Face cachée : `pointer-events: none`, `inert`, `aria-hidden`.
- **Le pari** validé est transmis à la Demande de parloir (bouton or « Demander une visite · pari n° X » dans le pied de page ; avant : « Retourne la pancarte pour parier »). Rien n'est enregistré avant l'envoi ; le résultat n'est jamais révélé avant la visite (règle 14).
- **Signaler et Bloquer** : derrière l'icône drapeau en haut à droite (44 px, « Signaler ou bloquer »), qui ouvre les parcours existants.
- **États** (inchangés depuis la 9g) : « Demande envoyée » et « Parloir complet » désactivés, explications sinon ; « Voir ma Fiche » pour le Bad, verso consultable, sans pari ni demande.
- **Couleurs** selon le genre de la personne affichée ; encre sur papier plus foncée pour l'AA (rouge `#9A1226`, or `#665010`) ; aucun texte posé directement sur le mur.
- **Jamais affichés** (SPEC §5, non négociable) : date de naissance, prénom ou nom réel, taille. **N° d'écrou** aléatoire, jamais l'identifiant interne.

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
| `FicheShow.dc.html` (+ `img/`) | Fiche d'un Bad v7 : mur commun, 3 poses, pancarte agrandissable (2026-10-24) | 9 |
| `FichePancarte.dc.html` | Fiche 9g, remplacée par la v7 | 9 |
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
