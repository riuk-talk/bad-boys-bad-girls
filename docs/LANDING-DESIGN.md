# Page d'accueil v2 et jeu du Casier — décisions du porteur (2026-10-04)

> Maquettes de référence (mobile 390 px) dans `docs/design/` : `landing-centree.html`, `onboarding-visiteur-entraine-toi.html`, `onboarding-bad-teste-ton-casier.html`. Ce sont des maquettes (format d'un outil de design, styles en ligne) : reproduis **le rendu**, pas le code. Les textes restent ceux de `LANDING-COPY.md`.
> À faire **après la validation de la Phase 2b**, dans une petite phase dédiée « 2c · Habillage » (ou au début de la Phase 3 si tu préfères : propose-moi le découpage).

## 1. Page d'accueil : version « centrée » (fusion Dossier + Néon)

Principe : **tout le texte centré**, rythme vertical régulier, ambiance prison + néon de nuit.

**Logo sur fond transparent** : utilise `public/brand/logo-3d-transparent.png` (fond noir retiré, recadré, 1105 × 1032) pour la page d'accueil et partout où le logo est posé sur la page ; régénère les variantes AVIF/WebP transparentes avec `pnpm brand:build` (à adapter). L'image Open Graph garde la version sur fond noir (`logo-3d.png`), car les réseaux sociaux affichent mal la transparence.

1. **Hero centré** : enseigne néon rouge « OUVERT AUX VISITES » (bordure + halo, léger grésillement) → logo 3D → titre « Pour ceux qu'on a toujours trouvés trop. » avec **« trop. » en or lumineux** → accroche → les deux portes.
2. **Fond toise** derrière le hero : lignes horizontales fines tous les 44 px et graduations (200 → 90) **des deux côtés**, discrètes (contraste faible, purement décoratif, `aria-hidden`).
3. **Les deux portes, côte à côte** (texte centré, halo lumineux, zone tactile entière cliquable, ≥ 44 px) :
   - **Je suis Bad = une cellule** : cadre or, barreaux verticaux en fond, étiquette « CELLULE B ».
   - **Je viens visiter = une vitre de parloir (pas de barreaux)** : cadre rouge, vitre avec reflets en diagonale, **hygiaphone** (cercle perforé de petits trous pour parler) au centre, **icône de combiné téléphonique** (lucide `Phone`) en haut à droite, étiquette « PARLOIR ».
4. **Bandeau rouge défilant** pleine largeur sous le hero : « Coupables de charme ★ Bad, pas toxique ★ Ici, rien ne se fait sans ton accord ★ » (boucle CSS, `aria-hidden`, arrêté si `prefers-reduced-motion`).
5. **Côté Bad** : sur-titre « — TU PASSES À LA TOISE — » (Special Elite), titre doré lumineux, puis 3 **« pièces à conviction »** : cartes papier crème, texte centré, bande de scotch dorée centrée en haut, « PIÈCE N° 1/2/3 ». Pas de rotation des cartes (harmonie).
6. **Côté Visiteur** : sur-titre « — TU VIENS EN VISITE — », titre néon rouge, 3 cartes sombres centrées avec le numéro en néon au-dessus du titre.
7. **La Promenade** : encadré à bordure dorée, « 21:00 » en grand chiffre doré lumineux au-dessus du titre.
8. **« Ici, rien ne se fait sans ton accord. »** : trois blocs centrés séparés par un filet : « CÔTÉ BAD » (or), « CÔTÉ VISITEUR » (rouge), « POUR TOUS » (crème), chacun avec sa phrase.
9. **Charte** : « Bad, pas toxique. » en rouge + les 3 lignes l'une sous l'autre + lien « Lire la Charte ».
10. **Final** : « Coupables de charme… » en Yellowtail néon, « Ton Dossier ou ton Permis t'attend. », deux gros boutons pleine largeur « Ouvrir mon Dossier » (or) et « Prendre mon Permis » (contour rouge).
11. Sur grand écran : même structure, contenu centré dans une colonne max ~640 px pour le texte ; les deux portes et les cartes peuvent passer en 2 ou 3 colonnes.

Contraintes inchangées : budget JS (tout en CSS, aucun JS pour les animations), contrastes AA (les halos ne remplacent jamais le contraste du texte), `prefers-reduced-motion` respecté, aucune chaîne en dur.

## 2. Le jeu du Casier dans l'inscription

### 2.1 Visiteur : étape « Entraîne-toi » (première étape du Permis de visite)
- Écran : « ENTRAÎNE-TOI » / « Un vrai, deux faux. Lequel est vrai ? » + explication courte.
- Un **Casier d'exemple clairement marqué « EXEMPLE FICTIF · CASIER N° 000 »** (pas un vrai membre) : 3 chefs d'accusation en boutons.
  - « A traversé l'Espagne à moto sans réserver une seule nuit. »
  - « S'est fait sortir d'un karaoké pour avoir chanté trop fort. » (le vrai)
  - « A un tatouage dont personne ne connaît le sens. »
- Au toucher : tampon animé « BIEN VU ! » (vert) ou « RATÉ ! » (rouge), le vrai est mis en évidence, phrase de révélation, puis l'encadré : « Sur le site, le verdict reste secret jusqu'à la visite. Il s'affiche en premier message du Parloir, pour vous deux. Juste ou faux, ta demande part toujours. »
- Bouton « J'ai compris, je prends mon Permis » ; lien « Passer » (l'étape n'est pas obligatoire). Rien n'est enregistré en base.
- Le vert de « BIEN VU » doit aussi se distinguer par l'icône/le texte, pas seulement la couleur.

### 2.2 Bad : étape « Teste ton Casier » (juste après la saisie du Casier)
- Écran : « TESTE TON CASIER » / « Voilà ce que verront les Visiteurs ».
- Aperçu de **son propre Casier** tel qu'un Visiteur le voit ; le vrai porte une étiquette « LE VRAI · visible par toi seul ».
- Encadré « Les conseils du Souffleur » : même longueur pour les trois phrases ; des faux plausibles (ni impossibles, ni banals) ; un vrai surprenant.
- Boutons « Mon Casier est prêt » (suite) et « Le retravailler » (retour à la saisie).
- Bonus si simple : un indicateur automatique « Attention, une phrase est beaucoup plus longue que les autres » (écart de longueur > 40 %), conseil non bloquant.

## 3. Vérification demandée
Captures mobile (390 px) et desktop de la nouvelle landing et des deux écrans, Lighthouse mobile de la landing (budget JS et LCP inchangés), axe-core 0 violation.
