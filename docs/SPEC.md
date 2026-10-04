# SPEC — Bad Boys & Bad Girls (v7)

> v6.1 : décisions de Phase 0 (`docs/PHASE0-DECISIONS.md`). v6.2 : décisions de Phase 1 (`docs/PHASE1-DECISIONS.md`).
> **v7 : changement de concept décidé par le porteur (`docs/CONCEPT-V2.md`, 2026-10-03)** : deux rôles (Bad et Visiteur), demande de parloir à la place de la Plaidoirie, heures de visite, Parloir limité aux 30 minutes de la visite puis Permis permanent, Web Push dans le MVP, Promenade, lancement « les Bads d'abord ».
> **v7.3 (2026-10-04, `docs/LANDING-DESIGN.md`)** : landing centrée (logo transparent, porte cellule / porte vitre de parloir avec hygiaphone), étape Visiteur « Entraîne-toi » (4), étape Bad « Teste ton Casier » (Phase 3), exception de couleur verte (§1 bis).
> **v7.2 (2026-10-04, `docs/LANDING-COPY.md` correction n° 2, `docs/CONCEPT-V2.md` §9)** : « Le Juge, c'est toi » devient **« Le Courrier »** ; le principe « Ici, c'est toi le juge » devient **« Ici, rien ne se fait sans ton accord. »** ; plus aucun « juge » dans l'interface.
> **v7.1 (2026-10-04, `docs/LANDING-COPY.md`)** : le Parloir est le lieu où l'on discute ; « Libération » est retiré, après une visite réussie **le Permis devient permanent** (tampon « PERMIS PERMANENT ») ; « aveux » est retiré, on dit toujours « chefs d'accusation » ; le texte de la landing est celui de LANDING-COPY.md, mot pour mot.
> **v7 validée** par le porteur (`docs/CONCEPT-V2-DECISIONS.md`) : les 13 règles marquées **(validé v7)** sont celles que j'avais dû préciser ; la **règle 14** (pari entièrement secret jusqu'à la visite, y compris pour le Bad) est intégrée en §7 et §8. Nom de domaine provisoire : `[DOMAINE]`.

## 0. Priorités

Tout est **P0** (indispensable au lancement), sauf les éléments marqués **[P1]** : ils sont construits après l'audit final, en Phase 9, uniquement si le porteur du projet le valide. Objectif : ouvrir le premier quartier vite, puis améliorer avec de vrais retours.

## 1. Positionnement

- **Esprit (mots du porteur)** : un site de rencontre **dans le même esprit que les prisons**. Tout le parcours suit cette métaphore (lexique §1 ter), en style **cartoon et léger**.
- Cible : adultes (18+) **qu'on a toujours trouvés « trop »** : trop francs, trop tatoués, trop libres, trop nocturnes, trop entiers. Moto, rock/rap, vie nocturne, goût du risque, anticonformisme. Formulation de la landing : « Pour ceux qu'on a toujours trouvés trop. »
- « Bad » = une attitude et une esthétique, **jamais** de la toxicité. Le site valorise la franchise et l'audace, et sanctionne le harcèlement, le contrôle et le mépris.
- **Deux rôles** (§2) : le **Bad** passe à la toise et reçoit des demandes de visite ; le **Visiteur** demande des visites. Les deux genres peuvent prendre les deux rôles.
- Différenciation : pas de swipe, pas de match. On demande une **visite au Parloir** en pariant sur le **Casier** d'un Bad. Le pari sert de brise-glace : personne n'a à écrire le premier message.
- **Ici, rien ne se fait sans ton accord.** (vrai pour les deux rôles) Le Bad choisit qui il reçoit : il accepte la visite ou classe l'affaire. Le Visiteur choisit qui il vient voir et quand (créneau parmi ceux proposés). Après la visite, rien ne continue sans l'accord des deux. L'écran où le Bad reçoit les demandes s'appelle « Le Courrier ». Le mot « juge » n'apparaît nulle part dans l'interface.
- Univers **cartoon** : tampons, toise, dossiers, parloir, promenade. Jamais d'imagerie carcérale réaliste (barreaux, menottes, uniformes, miradors).
- **Interdit absolu** : aucun nom, logo, blason, écusson ou insigne d'une administration réelle (Police nationale, Gendarmerie, Ministère de la Justice, Administration pénitentiaire, Marianne, drapeaux officiels, polices étrangères). Les tampons et en-têtes utilisent uniquement la marque « Bad Boys & Bad Girls ».
- L'univers habille le **décor** (en-têtes, tampons, fonds), jamais les **échanges** : dans le Parloir, les messages affichent les pseudos, pas des rôles (« Détenu », « Visiteur »).
- Les **fonctions de sécurité gardent des mots simples** : Signaler, Bloquer, Conseils sécurité. Jamais de métaphore sur ces boutons.
- Aucun terme hérité des autres applis dans l'UI : ni « match », ni « swipe », ni « like ».
- Lancement : France, quartier par quartier (Var et Alpes-Maritimes en premier), architecture prête pour l'international.

## 1 bis. Références visuelles (retenues des maquettes)

- **Palette unique, celle du logo** : noir `#0E0E10`, or `#D4A437`, rouge `#E0233F`, crème `#F2E8D5`. **Exception (v7.3, validée par le porteur)** : un vert réservé aux seuls retours « BIEN VU ! » et « LE VRAI » du jeu du Casier — `#1D6B43` sur papier/crème (5,06:1), `#3CCF86` sur fond sombre (9,6:1) — toujours accompagné d'une icône et d'un texte (jamais la couleur seule). Les néons de la landing utilisent des teintes dérivées du rouge et de l'or (`#FF3355`, `#FFD1D8`, `#F4D27A`), pas de nouvelle couleur. Pas de rose néon ni d'orange comme couleurs principales. Un seul logo (le monogramme BB couronne/cornes) : aucun autre emblème.
- **La Fiche du Bad façon dossier** : carte papier crème légèrement vieilli, bandeau noir en en-tête avec le pseudo en Anton, numéro de dossier (dérivé de l'identifiant, ex. `BB-0427`), trombone décoratif, sections titrées en capitales (Signes distinctifs, Chefs d'accusation, Bio).
- **Le Permis de visite** : carte plus petite, format « laissez-passer » cartoon (photo, pseudo, âge, ville, Motif de visite, badges Casier vierge / Visites honorées), tampon « PERMIS DÉLIVRÉ » une fois la photo validée. Aucune ressemblance avec un document officiel réel (pas de bande tricolore, pas de mention « République »).
- **Mobile d'abord** : sur téléphone, la Fiche est verticale (photo sur toise en haut, puis le dossier en dessous). La mise en page en paysage est réservée aux écrans ≥ 1024 px. Corps de texte ≥ 16 px.
- **Tampons** : cercle ou écusson à double contour, encre légèrement irrégulière, incliné de quelques degrés. Liste : « BONNE CONDUITE », « CASIER VIERGE », « PERMIS DÉLIVRÉ », « VISITE ACCEPTÉE », « PERMIS PERMANENT », « AFFAIRE CLASSÉE ». Le tampon « COUPABLE » reste un élément décoratif de la marque (signature « Coupables de charme… »).
- Les visuels générés par IA (visages) ne servent qu'aux maquettes ; en marketing, ils portent la mention « Illustration » et ne sont jamais présentés comme des membres.

## 1 ter. Lexique du parcours (à appliquer dans toute l'interface)

| Moment | Nom dans le site |
|---|---|
| Inscription Bad | Le Dossier (Fiche + Casier) |
| Inscription Visiteur | Le Permis de visite |
| Validation photos / modération | Le Greffe (« Permis délivré par le Greffe ») |
| Les 3 phrases du Bad | Le Casier (1 vrai, 2 faux) |
| Sélection du soir | La Promenade |
| Liste complète des Bads | La Découverte |
| Pari + mot du Visiteur | La Demande de parloir |
| Demandes de visite reçues par le Bad | Le Courrier |
| Refus | Affaire classée |
| Créneaux proposés | Les Heures de visite |
| Lieu où l'on discute (visite de 30 min, puis sans horaire avec le Permis permanent) | Le Parloir |
| Les deux veulent continuer | Le Permis permanent (le Parloir reste ouvert entre eux, sans horaire) |
| Vrai rendez-vous | La Cavale |
| Badge de confiance du Bad | Bonne conduite |
| Badge de confiance du Visiteur | Casier vierge |
| Présence aux visites | Visites honorées |
| Ville / zone de lancement | Le Quartier (« Ton quartier ouvre bientôt ») |
| Bad trop sollicité | Parloir complet |

## 2. Principes non négociables

1. **Un site de rencontre vide est un site mort.** Tout ce qui aide à atteindre une masse critique locale de Bads passe avant les fonctionnalités secondaires (§3).
2. **Sans Bads à l'aise, le site meurt.** Chaque arbitrage protège d'abord la personne sollicitée (le Bad), pas celle qui sollicite. D'où le Permis de visite obligatoire, la réputation visible du Visiteur et le plafond « Parloir complet ».
3. **Minimisation des données (RGPD art. 5)** : on ne collecte que ce qui sert une fonction visible.
4. **Rien n'est public.** Aucune Fiche ni aucun Permis n'est visible sans être connecté, aucune page de l'application n'est indexée par les moteurs de recherche. Un Bad ne voit un Visiteur que lorsque ce Visiteur lui a envoyé une demande ; un Visiteur ne voit jamais un autre Visiteur ; un Bad ne voit jamais un autre Bad (hors aperçu de sa propre Fiche).

## 2 bis. Les deux rôles

- Chaque membre a **un rôle** : `bad` ou `visitor`. **Un Bad ne demande pas de visite. Un Visiteur n'en reçoit pas.**
- **Choix du rôle** : deux portes sur la landing, **« Je suis Bad »** (je passe à la toise, je reçois des visites) et **« Je viens visiter »** (je cherche un bad boy ou une bad girl). La porte choisie est transmise à l'inscription et enregistrée avec le compte ; l'étape « Ton rôle » de l'onboarding (§4) l'affiche **présélectionnée** et permet de la confirmer ou de la corriger. Une inscription arrivée sans porte (lien direct) choisit à cette étape. **(validé v7 : le concept dit à la fois « rôle fixé avant la création du compte » et « étape Ton rôle après l'identité » ; cette lecture réconcilie les deux)**
- **Changement de rôle** dans les paramètres, **1 fois par 7 jours** au plus :
  - **Bad → Visiteur** : le Casier est masqué (conservé, pas supprimé) ; les demandes de visite en attente sont classées avec le message neutre ; les visites programmées sont annulées avec notification à l'autre personne. Le Permis exige un Motif de visite : s'il est vide, il est demandé avant de valider le changement. Les conversations au Parloir sans horaire (Permis permanent) continuent.
  - **Visiteur → Bad** : la Fiche n'apparaît nulle part tant que le Casier n'est pas rempli ; les demandes envoyées en attente sont annulées ; les visites programmées sont annulées avec notification. Les conversations au Parloir sans horaire (Permis permanent) continuent.
  - La photo d'identité déjà validée reste valable dans les deux sens (pas de nouvelle file au Greffe).

## 3. Lancement quartier par quartier (« les Bads d'abord »)

- Configuration `launch_zones` (admin) : chaque quartier = une ville + un rayon + un fuseau horaire, un statut `waitlist` ou `open`, des seuils d'ouverture paramétrables.
- La zone d'un membre est déterminée par sa ville (zone la plus proche dont le rayon contient la commune). Quand l'admin crée ou modifie une zone (centre, rayon), la zone de **tous les membres concernés est recalculée**.
- **Ordre d'ouverture** :
  1. **Les cellules ouvrent** (« Les cellules ouvrent à Toulon ») : dans un quartier en `waitlist`, les Bads s'inscrivent et complètent leur Dossier. Leur Fiche n'est visible par personne tant que le quartier n'est pas ouvert.
  2. **Les Visiteurs prennent leur permis** : ils s'inscrivent, font valider leur photo, mais restent sur **liste d'attente** avec la jauge du quartier. Ils ne voient pas encore les Bads.
  3. **Le quartier ouvre aux visites** quand le seuil de Bads est atteint : l'admin ouvre le quartier (ou ouverture automatique si l'option est activée), une notification et un e-mail préviennent tous les membres du quartier.
- **Calcul du seuil (validé v7)** :
  - **Bad compté** = rôle `bad`, onboarding terminé (Casier compris), photo d'identité validée, non banni, non suspendu, non masqué, `is_seed = false`, **pas en pause**, connecté dans les **30 derniers jours**. Raison : ouvrir un quartier sur des Bads partis ou en pause donnerait une Promenade vide aux Visiteurs.
  - **Bad girl** = Bad compté de genre `femme`.
  - **Condition d'ouverture** : `bads ≥ threshold_bads` (défaut **50**) **et** `bad_girls ≥ ceil(threshold_bads × threshold_women_pct / 100)` (défaut 40 % → **20 bad girls**) **et** `bad_boys ≥ ceil(threshold_bads × threshold_men_pct / 100)` (défaut 20 % → **10 bad boys** ; mettre 0 pour désactiver).
  - Planchers **absolus** plutôt qu'un pourcentage du total : avec un pourcentage, l'arrivée de nombreux bad boys ferait **baisser** la jauge des bad girls et pourrait bloquer l'ouverture indéfiniment. Le plancher de bad boys évite d'ouvrir un quartier où les Visiteurs qui cherchent des hommes ne verraient personne.
  - Exemple : 62 Bads dont 21 bad girls et 38 bad boys (3 autres) → 62 ≥ 50, 21 ≥ 20, 38 ≥ 10 → prêt. 80 Bads dont 18 bad girls → pas prêt (il manque 2 bad girls), même si le total dépasse le seuil.
  - **Jauge** (page « Ton quartier ouvre bientôt ») : trois barres, chacune plafonnée à 100 % : « Bads : 41/50 », « Bad girls : 14/20 », « Bad boys : 23/10 ✓ ». Les Bads voient en plus le **nombre réel de Visiteurs ayant leur permis** dans le quartier (« 37 visiteurs attendent l'ouverture ») : chiffre réel, jamais arrondi vers le haut ni inventé.
  - La jauge peut **redescendre** (un Bad se met en pause ou devient inactif) : c'est voulu, elle mesure l'offre réelle.
  - **Un quartier ouvert ne se referme jamais automatiquement**, même si le nombre de Bads redescend sous le seuil (seul l'admin peut le repasser en `waitlist`).
  - Calcul exécuté à chaque affichage de la jauge (`zone_progress()`) et chaque jour par la tâche `auto_open_zones()` ; quand un quartier devient prêt, l'admin est prévenu (e-mail admin), et le quartier s'ouvre seul si `auto_open` est activé.
- Hors quartier (commune dans aucun rayon) : inscription et Dossier/Permis fonctionnent ; page « Ton quartier ouvre bientôt » sans jauge, avec le lien de parrainage.
- Mode `launch_mode = open` global disponible pour désactiver ce mécanisme.
- Parrainage : lien unique par membre, compteur visible (« 3 complices recrutés »), aucune récompense financière.

## 4. Parcours utilisateur

1. **Landing** (seule page indexée) : logo 3D, promesse, **deux portes** (« Je suis Bad » / « Je viens visiter »), le déroulé en étapes de chaque côté (Bad : Ouvre ton Dossier → Le Courrier → Le Parloir ; Visiteur : Prends ton Permis → Demande une visite → Le Parloir), la Charte « Bad, pas toxique », Se connecter. Aucune fausse donnée, aucun faux témoignage.
2. **Inscription** (e-mail + mot de passe, ou lien magique) + Turnstile. La porte choisie est transmise (`?role=bad|visitor`) et enregistrée dans les métadonnées du compte, comme le parrainage.
3. **Onboarding court** (sauvegarde et reprise à chaque étape) :

   | # | Bad — le Dossier (objectif < 5 min) | Visiteur — le Permis de visite (objectif ≈ 3 min) |
   |---|---|---|
   | 1 | Date de naissance + attestation 18+ + CGU | idem |
   | 2 | Pseudo, genre, ville | idem |
   | 3 | **Ton rôle** (présélectionné par la porte) | idem |
   | 4 | Qui tu cherches (genres + âges) + consentement art. 9 | **Entraîne-toi** (v7.3, facultatif : pari sur un Casier fictif « Casier n° 000 », rien n'est enregistré, lien « Passer ») |
   | 5 | 1 photo minimum (visage visible) | Qui tu viens voir (genres + âges) + consentement art. 9 |
   | 6 | Le Casier (1 vrai, 2 faux) | 1 photo (visage visible) |
   | 7 | **Teste ton Casier** (v7.3, Phase 3 : aperçu tel que le voient les Visiteurs, conseils du Souffleur) | **Motif de visite** (présentation, 280 caractères, obligatoire) |
   | 8 | 10 questions du QCM (le socle, §9) | 10 questions du QCM (le socle, §9) |

   - La contrainte 18+ porte sur la **Fiche** : le compte d'authentification existe avant la saisie de la date de naissance, mais un profil sans date de naissance valide (≥ 18 ans, vérifiée en base) n'est visible nulle part et ne peut rien faire. Les comptes dont l'onboarding n'est pas terminé sont supprimés après 30 jours.
4. **Le Greffe** : la photo d'identité est « en attente de validation » jusqu'à la décision de la modération (objectif < 12 h, affiché).
   - **Bad** : sa Fiche n'apparaît nulle part avant la validation. Il peut compléter sa Fiche (présentation, signes distinctifs, autres photos, 10 questions restantes) ; une jauge « Fiche complète à X % » l'y encourage.
   - **Visiteur** : **il regarde tout de suite, il demande après validation**. Dès l'onboarding terminé (dans un quartier ouvert), il voit la Promenade et la Découverte ; le bouton « Demander une visite » affiche « Permis en attente au Greffe » tant que la photo n'est pas validée. Validation → tampon **« PERMIS DÉLIVRÉ »**.
5. **Visiteur** : Promenade (ou Découverte) → Fiche d'un Bad → **Demande de parloir** → le Bad accepte et propose des **Heures de visite** → le Visiteur choisit un créneau → **la visite au Parloir** (30 min) → **Permis permanent** ou Affaire classée.
6. **Bad** : écran d'accueil = **« Le Courrier »** (demandes reçues) + **« Mes visites »** (agenda des visites programmées, compte à rebours).
7. **Espace du Visiteur** : La Promenade, La Découverte, **Mes demandes** (en attente / acceptée → choisir un créneau / classée), **Mes visites** (agenda + compte à rebours), **Devenir Bad** (paramètres).

## 5. La Fiche du Bad

- Pseudo (3–20 caractères, unique ; e-mails, téléphones et liens refusés).
- Âge (calculé depuis la date de naissance, date jamais affichée), ville (pas d'adresse, pas de GPS).
- Genre : `homme`, `femme`, `non-binaire`, `autre`. Genres recherchés : multi-sélection. **Pas de champ « orientation »** : les genres recherchés suffisent au fonctionnement (minimisation).
- Photos : 1 à 6. La première est la « photo d'identité » : visage visible obligatoire, affichée sur un fond de toise (lignes 120–200). Pas de nudité.
- **[P1] Option « Alignement 3 poses »** (à partir de 3 photos validées) : les 3 premières photos en triptyque façon photo signalétique. Sinon, galerie classique.
- Présentation : 500 caractères max (facultative).
- Signes distinctifs (max 5), liste configurable en base (`tribes`) : Biker, Tatoué·e, Noctambule, Rockeur·se, Rap dans le sang, Street, Tête brûlée, Fêtard·e, Voyageur·se, Sport extrême, Gamer, Franc-parler.
  - Chaque signe peut recevoir **une précision facultative** (60 caractères) : « Tatoué·e — dragon sur la nuque ». Les précisions alimentent aussi le Souffleur.
- La date de naissance, le nom réel et la taille exacte ne sont **jamais** affichés (seulement l'âge).
- Le Casier (§6), sans indication du chef vrai.
- Indice de complicité avec le Visiteur qui regarde + les 3 principaux points communs du QCM.
- Badges : **Bonne conduite**, **[P1]** « Complices recrutés ».
- Actions (pour un Visiteur) : **Demander une visite**, **Signaler**, **Bloquer**.
- Statut de disponibilité réglé par le Bad (§7) : « Ouvert aux visites » / « Parloir complet ».
- **Mettre ma Fiche en pause** : la Fiche disparaît de la Promenade et de la Découverte ; les demandes en attente restent ; les visites programmées et les conversations au Parloir sans horaire continuent. En pause, on ne reçoit plus de nouvelles demandes. Réactivation en un clic. Après 30 jours de pause, les chemins des photos publiques sont renouvelés (§11).
- **Exception de visibilité** : on peut toujours ouvrir la Fiche (ou le Permis) d'une personne avec qui on a une demande, une visite ou une conversation en cours, même si elle est en pause ou inactive. Le blocage reste prioritaire.
- **Fiches inactives** : sans connexion depuis 21 jours → retirée de la Promenade et affichée en fin de Découverte ; depuis 90 jours → masquée partout, e-mail « Ta Fiche est en veille » avec lien de réactivation.

## 5 bis. Le Permis de visite (Fiche du Visiteur)

- Obligatoire et **non négociable** : c'est la sécurité des Bads.
- Contenu : pseudo, âge, ville, **1 photo validée par le Greffe** (visage visible), **Motif de visite** (présentation, 280 caractères, obligatoire), signes distinctifs (facultatifs, avec précisions), QCM (10 questions du socle, pour l'indice de complicité). **Pas de Casier.**
- **1 seule photo affichée** : la photo d'identité. Un ancien Bad devenu Visiteur garde ses autres photos en réserve (non affichées) ; elles réapparaissent s'il redevient Bad. **(validé v7)**
- **Réputation visible par les Bads** :
  - **« Casier vierge »** : aucun signalement retenu contre ce membre et aucune sanction (avertissement, suspension) dans les 12 derniers mois. **(validé v7 : durée de 12 mois)**
  - **« Visites honorées : X/Y »** : Y = visites programmées de ce Visiteur arrivées à leur heure (hors visites annulées par le Bad ou annulées plus de 2 h avant) ; X = celles où il était présent (§7 ter). Avant la première visite échue : « Nouveau visiteur ». Le taux d'absence est donc visible.
- Visible uniquement par un Bad qui a reçu une demande de ce Visiteur (en attente, acceptée, en visite, Permis permanent), et par le Visiteur lui-même (aperçu « tel que le voit un Bad »).
- Aucune demande de visite possible tant que la photo n'est pas validée.

## 6. Le Casier (Bad uniquement)

- 3 « chefs d'accusation », 120 caractères max chacun : **1 vrai et 2 faux**. L'auteur coche lequel est **vrai**.
- Ton : faits drôles et personnels. Exemples :
  - « A déjà traversé l'Espagne en moto sans réserver une seule nuit »
  - « A un tatouage dont il/elle refuse d'expliquer le sens »
  - « S'est fait virer d'un karaoké pour avoir chanté trop fort »
- **Assistant de Casier** (obligatoire : écrire 3 chefs d'accusation est difficile) :
  - une banque d'au moins 60 amorces à trous, classées par thème (voyage, soirée, moto, amour, enfance, travail, bêtises) : « A déjà ___ sans ___ », « S'est fait ___ pour avoir ___ », « N'a jamais avoué à personne ___ » ;
  - le parcours guide : **d'abord le vrai** (« Ton fait le plus marquant »), **puis deux faux crédibles** (« Invente deux chefs d'accusation qu'on pourrait croire ») ;
  - bouton « Autre idée » pour tirer une nouvelle amorce ; écriture libre toujours possible ;
  - un aperçu montre le Casier tel que les Visiteurs le verront (ordre mélangé, sans indication du vrai).
- Qualité : moins de 25 caractères par ligne → conseil, sans bloquer.
- **Règle du jeu** : chaque ligne est un **fait** précis sur sa propre vie, sinon il n'y a rien à deviner.
- **[P1] Clichés déconseillés** : liste en base (`casier_cliches`, FR + EN) qui détecte les formules génériques et affiche « Ça, tout le monde peut l'écrire. Donne un vrai fait. », avec une amorce proposée. Liste de départ : « vol de cœur(s) », « excès de charme », « trop beau / trop belle », « séduction non autorisée », « briseur / briseuse de cœurs », « coupable d'être moi-même », « tapage nocturne » (sans détail), « récidiviste de l'amour ». Conseil non bloquant.
- **Interdit** (écrit dans l'UI et les CGU) : vrais délits, violence, drogues, références à des mineurs, coordonnées. Un filtre par mots-clés (FR + EN, table `moderation_keywords`) **signale** le texte à la modération sans le bloquer.
- Modifier le Casier ne supprime pas les demandes en cours ; elles affichent « Casier modifié depuis ». Chaque demande **enregistre une copie** des 3 lignes et de l'index du vrai au moment de l'envoi : le résultat « Bien vu / Raté » reste juste même si le Casier change ensuite.

## 7. La Demande de parloir (remplace la Plaidoirie)

**But (mots du porteur)** : remplacer le match et briser le stress du premier message. Que le pari soit juste ou faux n'a aucune importance : c'est un prétexte pour entamer la conversation.

### Envoi (Visiteur)
- Sur la Fiche d'un Bad, **« Demander une visite »** ouvre une modale :
  1. le Visiteur **parie sur le chef d'accusation qu'il pense vrai** ;
  2. il peut ajouter un **mot** (280 caractères, facultatif) ; **Le Souffleur** propose 3 accroches (cliquables et modifiables) qui **ne citent jamais le chef choisi** (§8).
- La modale prévient : **« Ton pari reste secret jusqu'à la visite. »** (le mot, lui, est lu par le Bad avant sa décision).
- La demande part **dans tous les cas**, pari juste ou faux. Aucune révélation à l'envoi : écran « Demande déposée au Parloir ».
- **Règle 14 (validée) — le pari est secret pour les deux jusqu'à la visite** : ni le Bad ni le Visiteur ne voient le chef choisi ni le résultat avant l'ouverture de la visite. Le chef choisi **et** le résultat sont révélés **ensemble**, comme **premier message du Parloir** (§7 ter). Le pari n'influence donc jamais l'acceptation.

### Limites appliquées en base (fonction SQL `send_visit_request`, jamais seulement côté client)
- **Visiteur** : 5 demandes par 24 h glissantes ; 2 si le compte a moins de 24 h.
- **Couple** : 1 demande en cours maximum par Visiteur → Bad (en cours = en attente, acceptée, visite programmée) ; 30 jours d'attente après un classement (refus, classement automatique, visite sans Permis permanent, affaire classée après le Permis permanent).
- **Bad** : plafond de demandes en attente (défaut 15, réglable de 5 à 50). Plafond atteint → « Parloir complet » : la Fiche reste visible, le bouton est désactivé jusqu'à ce qu'il/elle traite ses demandes. Il/elle peut aussi se mettre en « Parloir complet » manuellement.
- Refus si : l'expéditeur n'est pas Visiteur, Permis non délivré (photo non validée), destinataire qui n'est pas Bad ou dont la Fiche n'est pas visible (pause, inactif, quartier fermé), blocage dans un sens ou dans l'autre, critères de genre et d'âge non réciproques.
- **Anti-arnaque** : 3 mots identiques ou quasi identiques envoyés par le même compte sur 7 jours → signalement automatique à la modération (sans blocage). Normalisation : minuscules, sans accents ni ponctuation, espaces réduits, coordonnées masquées ; « quasi identique » = similarité trigramme ≥ 0,9 ; mots vides exclus.
- **Supprimé en v7** : les plaidoiries croisées et « Coupables tous les deux » (sans objet : un Bad ne demande pas de visite).

### Réception (« Le Courrier »)
- Pour décider, le Bad voit **uniquement** : le Permis du Visiteur (photo, pseudo, âge, ville, Motif de visite, signes distinctifs, Casier vierge, Visites honorées), l'indice de complicité, les 3 points communs du QCM et le mot éventuel. **Jamais le chef choisi ni le résultat du pari** (règle 14) : aucune fonction ne les lui renvoie avant le début de la visite.
  - Le tableau de santé suit le taux d'acceptation selon pari juste/faux : il **doit être neutre** ; un écart significatif est traité comme un **bug de fuite d'information**.
- **Accepter la visite** → tampon « VISITE ACCEPTÉE », puis proposition des Heures de visite (§7 bis), dans le même écran.
- **Affaire classée** → le Visiteur reçoit le message neutre prédéfini (« Affaire classée. Pas de suite cette fois — bonne route. »). Jamais de silence.
- Sans réponse sous 7 jours → classement automatique avec le même message.
- **Conseils après 3 affaires classées de suite** (hors classements automatiques) : le Visiteur voit des conseils concrets tirés de son propre Permis (Motif de visite court, QCM incomplet, demandes sans mot), jamais de reproche. Les statistiques des autres membres ne sont jamais montrées.

## 7 bis. Les Heures de visite

1. **Le Bad accepte et propose 2 ou 3 créneaux** de 30 min, dans les 7 jours, chacun commençant **au moins 2 h** après la proposition. Raccourcis (heure locale du quartier, modifiables avant envoi) **(validé v7)** :
   - « Ce soir » → 21 h 00 aujourd'hui (si 21 h est à moins de 2 h : la première demi-heure possible, au plus tard 23 h 30 ; sinon le raccourci est grisé) ;
   - « Demain soir » → 21 h 00 demain ;
   - « Ce week-end » → samedi 18 h 00 (si on est samedi ou dimanche : dimanche 18 h 00, avec la même règle des 2 h).
   - Contrôles en base : créneaux distincts, sans chevauchement entre eux ni avec les **visites déjà programmées** du Bad.
2. **Le Visiteur choisit un créneau** dans les **48 h** (et avant le début du créneau choisi). Sans choix → la demande est classée automatiquement (message neutre, délai de 30 jours). Un créneau devenu indisponible (le Bad a entre-temps une visite programmée qui le chevauche, ou il commence dans moins de 15 min) est affiché grisé « plus disponible ». Le Visiteur ne peut pas avoir deux visites qui se chevauchent.
3. **« Aucun ne me va »** : le Visiteur le signale (une seule fois par demande) → le Bad propose de nouveaux créneaux dans les **48 h**, sinon la demande est classée automatiquement. **(validé v7 : délai de 48 h pour le Bad)**
4. **Annulation** d'une visite programmée : possible par l'un ou l'autre jusqu'au début, avec un message neutre prédéfini ; l'autre est notifié. Une annulation **moins de 2 h avant** compte comme une absence de celui qui annule (Visites honorées pour le Visiteur ; Bonne conduite pour le Bad). **(validé v7)**
5. **Rappels** : notification **1 h avant** et **à l'heure** (Web Push + in-app ; e-mail seulement si le membre l'a activé, dans la limite du quota).
6. **Une seule visite programmée à la fois par couple.** Un Bad peut avoir plusieurs visites programmées avec des Visiteurs différents, sans chevauchement.

## 7 ter. La visite au Parloir (30 minutes)

- Le Parloir s'ouvre **uniquement pendant les 30 min du créneau**, en temps réel, avec un **compte à rebours** visible.
- **Présence** : un membre est « présent » dès qu'il ouvre l'écran de la visite pendant le créneau (horodatage enregistré par la base, `join_visit()`). Si une seule personne est là : écran d'attente « En attente de [pseudo]… ».
- **Premier message automatique** (message système, affiché aux deux) = le chef choisi **et** le résultat du pari, révélés ensemble : « [Pseudo] a parié sur : "…" — Bien vu ! » ou « — Raté ! Le vrai était : "…" ». C'est le brise-glace. Si la première visite n'a pas lieu (absence, annulation), la révélation attend la visite suivante ; si aucune visite n'a lieu, le pari n'est jamais révélé.
- Puis le mot éventuel du Visiteur, s'il en a écrit un.
- Messages texte, 1 000 caractères max, 30 messages/min max ; e-mails, téléphones et liens masqués.
- **Signaler / Bloquer** toujours accessibles (en-tête), avec des mots simples. Bloquer met fin immédiatement à la visite.
- Les messages sont **conservés** (modération, signalements, puis Parloir sans horaire si le Permis devient permanent).
- **Absence** : si l'un des deux n'est pas présent **10 min** après le début, la visite est marquée « absent » (avec qui était absent) et se ferme. Chacun peut demander **un report** : le Bad repropose des créneaux (même règle qu'en §7 bis, 48 h). **Deuxième absence dans le même couple → affaire classée automatiquement.**
- **Fin de visite** : à la fin des 30 min, chacun choisit **« Prolonger »** ou **« Affaire classée »**, dans les **24 h** (sans réponse = classée).
  - Les deux choisissent Prolonger → **Permis permanent** : tampon « PERMIS PERMANENT », le Parloir reste ouvert entre eux, **sans horaire** (§13) et la **Cavale** devient disponible.
  - Sinon → affaire classée, message neutre (le choix de chacun n'est jamais révélé : l'autre voit seulement « Affaire classée »), délai de 30 jours.

## 7 quater. Web Push (dans le MVP)

- Les heures de visite ne fonctionnent pas sans rappels fiables : **Web Push** standard (clés **VAPID**, service worker, gratuit).
- Android / ordinateur : notifications directes. **iPhone** : uniquement si le site est installé sur l'écran d'accueil (iOS 16.4 ou plus récent, **à vérifier**) → afficher un **guide d'installation** au moment où un iPhone programme sa première visite.
- **Abonnement demandé au bon moment** : à la première demande envoyée (Visiteur) ou à la première demande acceptée (Bad), jamais à l'arrivée sur le site. Refus respecté (pas de nouvelle demande avant 30 jours).
- **Aucun service tiers choisi par nous** : envoi depuis notre serveur avec les clés VAPID. ⚠️ Techniquement, une notification Web Push transite toujours par le service de push du navigateur (Google pour Chrome/Android, Mozilla pour Firefox, Apple pour Safari) : le contenu est **chiffré de bout en bout**, mais ces services voient qu'une notification est envoyée. À écrire dans la politique de confidentialité.
- **Contenu minimal** : jamais de pseudo, de photo ou de texte de message dans la notification (« Ta visite commence dans 1 h », « Nouvelle demande de parloir »). Le détail s'affiche dans l'application, après connexion.
- Respect de la CSP (`worker-src 'self'`), abonnements supprimés quand le navigateur les déclare expirés.

## 8. Le Souffleur

- Génération **sans IA et sans API**, 100 % locale (`lib/prompter`), à partir de modèles de phrases.
- Entrées : réponses QCM des deux personnes, signes distinctifs communs, Motif de visite et présentation du Bad. **Jamais le chef d'accusation choisi** (règle 14 : le mot est lu par le Bad avant la visite).
- Trois accroches proposées dans la demande de parloir :
  - Point commun : « On a tous les deux répondu "{réponse}" à "{question}". Raconte-moi la dernière fois. »
  - Signe distinctif : « {Tribu} aussi. Ta meilleure histoire en 2 lignes, je te donne la mienne. »
  - Casier (sans désigner de ligne) : « Un de tes trois chefs d'accusation m'a fait rire. Je te dirai lequel au Parloir. »
- Au moins 10 modèles par type, en FR et EN dans les fichiers de messages ; choix aléatoire sans répétition immédiate.
- Si les données manquent (moins de 5 questions communes), le Souffleur propose des accroches génériques sur le Casier, sans en citer une ligne.

## 9. Le QCM et l'indice de complicité

### Mécanique (inspirée d'OkCupid)
Pour chaque question :
- **sa réponse** (une option) ;
- **les réponses acceptées chez l'autre** : par défaut « toutes » (un tap pour restreindre) ;
- **l'importance** : `peu` (poids 1), `important` (10, valeur par défaut), `indispensable` (50).

Calcul pour A et B sur les questions répondues par les deux (minimum 5, sinon « Pas encore assez d'indices ») :
- `satisfaction(A→B) = Σ poids_A des questions où la réponse de B ∈ acceptées_A / Σ poids_A`
- `indice = sqrt(satisfaction(A→B) × satisfaction(B→A))`, affiché en % arrondi.
- Une question « indispensable » non satisfaite dans un sens plafonne l'indice à 50 %.
- Implémenté en SQL (`complicity_score`) **et** en TypeScript pur (`lib/complicity.ts`), avec tests de parité.
- **Calculé à la volée** entre un Visiteur et des Bads (Promenade, Découverte, Fiche) ou entre un Bad et un Visiteur qui lui a écrit (« Le Courrier »). Pas de table de cache au MVP.

### Les 20 questions (seed FR ; traductions EN à produire)
Les **10 premières** sont demandées à l'inscription (le socle, pour les deux rôles) ; les 10 suivantes sont proposées ensuite.

1. Ce que tu cherches ici ? — Une histoire sérieuse, avec du piment / Voir où ça mène / Du fun sans prise de tête / Des complices de sortie
2. Enfants ? — J'en ai / J'en veux / Pas pour moi / Pas encore décidé
3. Tabac ? — Oui / Parfois / Non / Non, et ça me dérange
4. L'indépendance dans le couple ? — Non négociable / Importante, mais on partage beaucoup / Je préfère tout faire à deux
5. La jalousie en couple ? — Zéro, chacun sa liberté / Un peu, c'est humain / J'ai besoin d'être rassuré·e / C'est un sujet à poser tôt
6. Un vendredi soir idéal ? — Bar rock jusqu'à la fermeture / Balade moto de nuit / Canapé et film d'action / Je décide sur le moment
7. Les règles, pour toi, c'est… — Faites pour être contournées / Je les respecte si elles ont du sens / J'écris les miennes / Je les suis, en râlant
8. Un désaccord, tu le règles comment ? — Cash, tout de suite / J'attends de redescendre / Avec humour / Je boude un peu (j'avoue)
9. Ton rythme ? — Couche-tard / Lève-tôt / Aucun rythme / Ça dépend de la semaine
10. Alcool ? — Souvent en soirée / De temps en temps / Rarement / Jamais
11. Tatouages ? — J'en ai plein / Quelques-uns / Aucun, mais j'adore / Pas mon truc
12. Partir sur un coup de tête ce week-end ? — Mon sac est déjà prêt / Oui, si ce n'est pas trop loin / J'ai besoin d'un minimum de plan / Non merci
13. La musique qui te représente ? — Rock / metal / Rap / hip-hop / Électro / Un peu de tout
14. Ta sortie préférée ? — Concert / Bar ou club / Road trip / Soirée chez des potes
15. On te reproche le plus souvent… — D'être trop franc·he / D'être en retard / D'être une tête brûlée / De ne jamais lâcher l'affaire
16. La moto ? — J'en ai une / Passager·e avec plaisir / J'aimerais essayer / Pas pour moi
17. Les réseaux sociaux ? — J'y poste ma vie / Je regarde sans poster / Le strict minimum / Je n'en ai pas
18. Premier rendez-vous idéal ? — Un verre dans un bar / Une activité (billard, karting, bowling) / Une balade / Direct un concert
19. Les animaux ? — J'en ai / J'adore, mais pas chez moi / Pas fan / Indifférent·e
20. On te dit « t'es trop bad pour moi ». Tu réponds… — « Tant mieux. » / Je montre mon côté tendre / Je passe à autre chose / J'éclate de rire

Visibilité : les réponses d'un membre ne sont jamais affichées en liste complète ; seuls les 3 points communs (réponses identiques, triées par importance cumulée) et les réponses utilisées par le Souffleur sont montrés, à un membre connecté autorisé à voir la Fiche ou le Permis.

UI : une question par écran, réponse en un tap, « acceptées » et « importance » repliés sous un lien « Affiner » (valeurs par défaut sinon). Tables : `questions`, `question_options`, `answers`. Libellés traduits en JSON `{fr, en}`. Banc de questions optionnelles gérable par l'admin.

## 10. Conformité, sécurité, vie privée

> Les textes juridiques générés sont des **modèles** marqués `[À FAIRE VALIDER PAR UN JURISTE]`. Ne jamais les présenter comme définitifs.

### Âge (18+)
- Date de naissance obligatoire ; refus si < 18 ans **par contrainte/trigger Postgres**, pas seulement côté client. Critère : impossible d'avoir un profil utilisable avec un âge < 18 ans, même via l'API.
- Attestation « J'ai 18 ans ou plus » obligatoire, horodatée.
- Signalement « mineur » : traitement prioritaire. Masquage automatique immédiat si **2 signalements distincts** ou 1 signalement d'un membre ayant le badge **Bonne conduite**.

### RGPD
- **Genres recherchés = donnée révélant l'orientation sexuelle (art. 9)** : case de consentement explicite, séparée, non pré-cochée, sur l'écran « Qui tu cherches » / « Qui tu viens voir », avec un texte clair sur l'usage. Sans ce consentement, le service ne peut pas fonctionner : l'expliquer honnêtement. Retrait = suppression du compte proposée.
- Table `consents` historisée (type, version du texte, date, IP tronquée ; jamais écrasée).
- Pages : Politique de confidentialité, CGU, Mentions légales, Charte « Bad, pas toxique ». Placeholders `[À COMPLÉTER]`.
- Paramètres : **export de mes données** (JSON : ses propres messages sans le texte de l'autre personne, ses demandes envoyées/reçues et ses visites avec le seul pseudo de l'autre, ses réponses QCM, consentements, signalements faits sans données de la cible, notifications, abonnements push sans les clés) et **suppression du compte** (suppression réelle en cascade + fichiers Storage + abonnements push, confirmation par mot de passe ou lien e-mail).
- Suppression du compte : les messages de la personne supprimée sont **effacés en base** et remplacés par « Message supprimé » ; la conversation reste visible pour l'autre avec « Ce compte a été supprimé ». Les visites programmées sont annulées.
- Conservation après bannissement : uniquement l'empreinte (HMAC-SHA256 avec poivre secret) de l'e-mail, vérifiée par le hook « Before User Created », durée paramétrable (défaut 12 mois) `[À FAIRE VALIDER PAR UN JURISTE]`.
- Pas de traceur tiers ni d'analytics externe → cookies strictement nécessaires uniquement, pas de bandeau.
- Web Push : voir §7 quater (transit par le service de push du navigateur, contenu chiffré et minimal).
- Localisation : ville seulement ; distance calculée depuis le centre de la commune. Jamais de GPS appareil.
- Photos : **suppression des métadonnées EXIF** par ré-encodage côté serveur (et compression côté client).
- `noindex, nofollow` + `robots.txt` sur tout sauf la landing, les pages légales et la Charte ; aucune Fiche ni aucun Permis accessible sans session.

### DSA / modération
- **Signaler** sur Fiche, Permis, photo, Casier, demande de parloir et message ; catégories : faux profil, mineur, harcèlement, contenu sexuel, violence ou menace, arnaque, autre ; commentaire optionnel.
- **Bloquer** : effet immédiat et bidirectionnel (invisibles l'un pour l'autre, demandes annulées, visites annulées, conversation fermée), appliqué dans la RLS.
- File de modération admin (**le Greffe**), décision motivée ; le signaleur **et** la personne sanctionnée reçoivent l'exposé des motifs.
- Point de contact visible dans les mentions légales.

### Sécurité technique
- RLS activée sur **toutes** les tables, refus par défaut ; politiques testées avec **pgTAP**.
- Rôle admin dans une table séparée `admin_users`, **non modifiable** par les utilisateurs ; premier admin créé par un script SQL documenté.
- Colonnes sensibles de `profiles` (rôle, statut de modération, badge Bonne conduite, bannissement, compteurs) non modifiables directement par l'utilisateur : privilèges de colonnes ; le rôle change uniquement via `change_role()`.
- Server Actions : authentification vérifiée + Zod + limites en base.
- En-têtes : CSP stricte (+ `worker-src 'self'` pour le service worker), `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictive.
- Turnstile à l'inscription et à la connexion.
- Pseudo, présentation, Motif de visite, Casier, mots des demandes, messages : e-mails, numéros de téléphone et liens masqués (anti-arnaque).
- Au Parloir, une fois le Permis permanent, le masquage est **levé** dès qu'une Cavale est acceptée ou que les deux personnes ont chacune envoyé au moins 10 messages (messages de la visite compris), **à condition** que les deux comptes aient plus de 7 jours, qu'aucun signalement ne soit ouvert entre les deux personnes, et qu'aucun signalement ouvert dans les catégories arnaque, mineur, harcèlement ou violence/menace ne vise l'une d'elles. Encart : « Ne partage jamais d'argent ni de codes. » **Jamais de levée pendant la visite de 30 min.**
- Aucune clé secrète dans le client (la clé privée VAPID comprise) ; `.env.example` documenté.

## 11. Photos et modération d'images (le Greffe)

- Compression côté client avant envoi, puis ré-encodage côté serveur : WebP, deux tailles (1200 px ≤ 180 Ko, 400 px ≤ 30 Ko), sans aucune métadonnée. Vignettes partout sauf sur la Fiche ouverte.
- Upload dans le bucket **privé** `photos-pending` → **file de validation du Greffe** (critères : adulte, visage visible sur la photo d'identité, pas de nudité, pas de coordonnées) → copie vers le bucket **public** `photos` sous un chemin UUID non devinable. Refus → suppression + motif notifié. Pour un Visiteur, la validation de la photo d'identité délivre le Permis (tampon « PERMIS DÉLIVRÉ »).
- **Priorité de la file** : photos d'identité des Visiteurs dont le quartier est ouvert, puis Bads, puis photos secondaires. **(validé v7 : un Visiteur bloqué au Greffe ne peut rien faire)**
- Les fichiers de `photos-pending` sont supprimés dès la décision. Fichiers publics servis avec un `Cache-Control` long (chemins immuables).
- **Rotation de chemin** (nouvel UUID, ancien fichier supprimé) à la suppression d'une photo, après 30 jours de pause, au bannissement ; purge totale à la suppression du compte.
- **Seuil de bascule** : alerte admin quand le stockage dépasse 700 Mo ou l'egress saisi dépasse 3,5 Go/mois deux mois de suite (stockage calculé en SQL, egress saisi chaque mois par l'admin). La décision de payer reste humaine.
- Pas de détection automatique au MVP. Emplacement prévu pour plus tard.
- Notification admin (e-mail groupé) dès qu'il y a des photos en attente ; objectif de validation < 12 h, affiché.
- Pas d'optimisation d'image Vercel : `next/image` avec `unoptimized`, `width`, `height`, `sizes`, `loading="lazy"` hors de la zone visible.

## 12. La Promenade (écran d'accueil du Visiteur)

- Chaque jour à **21 h** (heure locale du quartier), **5 Bads « sortent dans la cour »** pour chaque Visiteur, choisis pour lui. **Seuls les Visiteurs** reçoivent la Promenade.
- But : un rendez-vous quotidien et une impression de rareté et de soin. C'est un raccourci quotidien ; la Découverte reste la liste complète.
- Sélection (fonction SQL `build_daily_promenade`, exécutée par la tâche planifiée) :
  - candidats = Bads dont la Fiche est visible (photo validée, Casier rempli, ni en pause ni inactifs, pas en « Parloir complet »), réciprocité genre/âge avec le Visiteur, quartier ouvert, pas de blocage, aucune demande ni conversation déjà échangée, pas déjà sortis pour ce Visiteur dans les 14 derniers jours ;
  - classement : indice de complicité, activité récente, puis **répartition de l'attention** : un Bad déjà très sollicité (demandes en attente > 50 % de son plafond) sort dans moins de Promenades ;
  - formule : score = indice de complicité (0–100, 0 si inconnu) + bonus d'activité (0–20), multiplié par 0,5 au-delà de 50 % du plafond ; un Bad sort dans **au plus 10 Promenades par jour** (paramétrable) ;
  - s'il y a moins de 5 candidats, afficher ceux qui existent, sans remplissage.
  - ⚠️ Capacité : au seuil d'ouverture (50 Bads × 10 sorties) = 500 places par soir, soit 5 Bads pour **100 Visiteurs** au plus. Au-delà, des Visiteurs reçoivent moins de 5 Bads : c'est le prix de la protection des Bads. Le tableau de santé suit la part des Visiteurs servis à moins de 5 ; l'admin peut ajuster le plafond.
- **Génération à l'avance, révélation à l'heure** : la tâche planifiée tourne dans l'heure qui précède et enregistre les sélections avec `visible_from = 21:00` ; l'application ne les montre qu'à partir de cette heure. Un Visiteur inscrit après la génération reçoit sa première Promenade à la génération suivante (en attendant : la Découverte).
- Calcul en SQL ensembliste (pas de boucle par paire). Critère : génération pour 5 000 Visiteurs et 1 000 Bads dans un même quartier en moins de 5 minutes.
- Heure calculée avec le fuseau du quartier, dates stockées en UTC.
- La sélection reste disponible jusqu'au lendemain 21 h. Notification « La Promenade commence » in-app (et push si abonné). **Pas d'e-mail quotidien** : e-mail hebdomadaire facultatif, désactivé par défaut.
- Compte à rebours jusqu'à la prochaine Promenade affiché quand la sélection du jour est vue en entier.

## 12 bis. La Découverte (Visiteurs uniquement)

- Accessible uniquement connecté, **aux Visiteurs**, dans un quartier ouvert. Montre les Bads de **tous les quartiers ouverts**, filtrés par distance (« France » = tous).
- Grille de Fiches, filtres : tranche d'âge, distance (10/25/50/100 km/France), signes distinctifs, « Bonne conduite uniquement », « actif récemment ».
- Réciprocité obligatoire (genre + âge dans les deux sens).
- Tri par défaut : indice de complicité, puis activité récente. Les Fiches « Parloir complet » sont affichées en fin de liste.
- Pagination par curseur (24 par page), une seule requête SQL (fonction `discover_bads`), exclusion des bloqués et des Fiches non validées.
- État vide soigné : « Personne de nouveau dans la cour pour l'instant » + élargir les filtres + lien de parrainage.

## 13. Le Parloir sans horaire (Permis permanent)

- Le Parloir est le lieu où l'on discute. Sans horaire seulement une fois le **Permis permanent** (§7 ter). Il prolonge la même conversation : les messages de la visite restent affichés en haut.
- Texte uniquement au MVP, 1 000 caractères max par message.
- **Le champ de saisie est toujours visible** en bas de l'écran ; les actions (Cavale, Classer l'affaire, Signaler, Bloquer) sont dans l'en-tête ou un menu, jamais à la place du champ.
- **Proposer une Cavale** (rendez-vous réel) : bouton dans l'en-tête. Formulaire : type de lieu (bar, café, concert, balade, activité), nom du lieu (texte libre), date et heure. L'autre répond **Accepter**, **Proposer autre chose** ou **Pas encore**. Une Cavale acceptée s'affiche en carte épinglée en haut, avec le rappel des conseils sécurité. Une seule Cavale en attente par conversation. Si le lieu contient « chez moi », « chez toi » ou une adresse privée, un avertissement conseille un lieu public (conseil, pas blocage).
- **[P1] Relance à 48 h** : si le Permis est permanent depuis 48 h sans Cavale proposée et que le dernier message a plus de 24 h, bandeau discret : « Toujours là ? Propose une Cavale ou classe l'affaire. » Une seule relance.
- **Temps réel** (Supabase Realtime, canal par conversation, RLS respectée), **ouvert seulement quand une conversation ou une visite est affichée**. Les compteurs (non-lus, demandes, visites, cloche) sont mis à jour par interrogation toutes les 60 s et au retour sur l'onglet. ⚠️ Les visites concentrent les connexions à 21 h : le plafond de connexions Realtime simultanées de l'offre gratuite (**à vérifier**, de l'ordre de 200) correspond à environ 100 visites simultanées. Repli automatique par interrogation toutes les 3 s si la connexion temps réel est refusée.
- Indicateur « lu », liste triée par activité, compteur de non-lus.
- Anti-spam : 30 messages par minute max (fonction SQL).
- « Classer l'affaire » : termine la conversation avec le message neutre ; plus d'envoi possible ; 30 jours avant une nouvelle demande entre ces deux personnes.
- Compte supprimé : la conversation reste visible pour l'autre, « Ce compte a été supprimé », sans pseudo ni photo ; messages effacés en base, affichés « Message supprimé ».
- Encart discret « Premier rendez-vous : lieu public, préviens un proche » avec lien vers Conseils sécurité.

## 14. Badges de confiance

- **Bonne conduite** (Bad, remplace Réglo) — calcul quotidien **(critères validés v7)** : compte de plus de 30 jours, au moins 3 visites où il/elle était présent·e, aucun signalement retenu, aucune absence ni annulation tardive (§7 bis) dans les 30 derniers jours. Retiré immédiatement si un signalement est retenu.
- **Casier vierge** (Visiteur) — §5 bis, calculé à l'affichage.
- **Visites honorées X/Y** (Visiteur) — §5 bis, calculé à l'affichage.
- Infobulle explicative sur chaque badge.

## 15. Administration et pilotage

- `/admin` (réservé à `admin_users`) : **le Greffe** (file photos, prioritaire), file signalements, textes signalés par mots-clés, recherche d'utilisateur, suspension/bannissement (motif obligatoire), historique des décisions, gestion des quartiers (seuils compris), des tribus, des mots-clés et des questions.
- **Tableau de santé par quartier** (calculé depuis nos propres tables, sans outil tiers ; `is_seed` exclus) :
  - inscrits, **répartition Bads/Visiteurs par genre** (l'indicateur n° 1), Dossiers et Permis complets ;
  - jauge d'ouverture (Bads comptés, bad girls, bad boys, Visiteurs en attente) ;
  - demandes envoyées/jour, **taux d'acceptation** (et selon pari juste/faux : doit être neutre, sinon fuite d'information à corriger), délai moyen de réponse, part des demandes classées automatiquement ;
  - **taux de créneau choisi** (demandes acceptées → visite programmée), part des « Aucun ne me va » ;
  - **taux de présence aux visites** (Bads et Visiteurs séparément), annulations tardives ;
  - **taux de Permis permanent après visite** ;
  - Cavales proposées et acceptées (le vrai indicateur : des gens qui se voient) ;
  - part des Visiteurs servis à moins de 5 Bads à la Promenade ;
  - rétention J7 et J30 par rôle ;
  - volume de signalements et délai de traitement ; délai de validation au Greffe ;
  - taux d'abonnement push et d'échecs d'envoi.

## 16. Notifications

- **In-app** : cloche + compteurs (demande reçue, visite acceptée + créneaux proposés, créneau choisi, « aucun ne me va », nouveaux créneaux, visite annulée, rappel 1 h, visite qui commence, absence, report, Permis permanent, affaire classée, nouveau message, Cavale proposée/acceptée/contre-proposée, Promenade ouverte, Permis délivré, décision de modération, ouverture du quartier).
- **Web Push** (si abonné, §7 quater) : demande reçue, visite acceptée, créneau choisi, rappel 1 h, visite qui commence, Permis permanent, nouveau message au Parloir (Permis permanent) (au plus 1 toutes les 15 min par conversation), Promenade ouverte. Préférences par type.
- **E-mail** (SMTP gratuit, quota limité) : demandes reçues et visites acceptées (regroupées, maximum 1 e-mail par jour et par membre), rappel de visite (**seulement si activé**), Cavale acceptée, ouverture du quartier, Permis délivré, Fiche en veille, rappel unique à J+7 pour un onboarding non terminé (priorité la plus basse) ; désinscription par type. Si le quota du jour est atteint, les e-mails restants passent au lendemain (sauf les rappels de visite, abandonnés s'ils sont dépassés).

## 17. Accessibilité et UX

- WCAG AA : contrastes, navigation clavier complète, focus visible, libellés sur tous les champs, `aria-live` pour les notifications et le compte à rebours de visite (annonces espacées, pas chaque seconde).
- `prefers-reduced-motion` : les animations de tampon deviennent un simple fondu.
- Écriture inclusive avec point médian dans l'UI ; `aria-label` sans point médian quand la lecture devient gênante.
- Tous les états sont conçus : chargement (squelettes), vide, erreur, hors ligne, attente de l'autre personne.

## 18. Performance (critères d'acceptation)

- Lighthouse mobile ≥ 90 en Performance, Accessibilité et Bonnes pratiques sur la landing, la Promenade, la Découverte, une Fiche, « Le Courrier » et le Parloir.
- **Core Web Vitals réels (75e centile)** : LCP < 2,5 s, CLS < 0,1, INP < 200 ms. Ce critère fait foi. En laboratoire, tolérance LCP ≤ 3,5 s.
- Mesure réelle (Phase 8) : bibliothèque `web-vitals` + route interne, données **agrégées** sans identifiant ni IP, conservées 90 jours.
- JS initial de la landing < 130 Ko compressé **en Brotli**. Le service worker n'est **pas** enregistré sur la landing.
- Toutes les pages sont rendues dynamiquement (nonce CSP).
- Server Components par défaut ; bibliothèques lourdes en `dynamic import`.
- Index SQL sur toutes les colonnes filtrées ou triées ; pas de requêtes N+1 ; `EXPLAIN ANALYZE` de `discover_bads` avec 1 000 Bads de test.

## 19. Données de test

- Un script de seed génère des Bads et des Visiteurs **fictifs** pour le développement et les tests de charge uniquement : colonne `is_seed = true`, jamais exécuté en production, visuels neutres (avatars générés).
- Ce n'est pas une exception à « ne jamais inventer » : c'est un outil de développement, jamais montré au public.

## 20. Hors périmètre du MVP (feuille de route)

- **La Virée** : sorties de groupe réelles par quartier (balade moto, concert). (≠ Cavale, rendez-vous à deux, dans le MVP.)
- Paris et Duels QCM.
- Photos dans le Parloir, appels vidéo (y compris pendant la visite).
- Vérification d'identité par selfie.
- Détection automatique des images.
- **Financement futur sans casser l'équité** (rien à coder au MVP) : billets pour La Virée, boutique d'objets de la marque. Règle dès maintenant : **jamais payer pour envoyer plus de demandes, ni pour être plus visible**.
- *(Retiré de cette liste en v7 : les notifications push web, désormais dans le MVP.)*

## 21. Contraintes des offres gratuites (à rappeler dans le README)

- Vercel Hobby : usage **non commercial** uniquement ; passer en Pro avant toute monétisation.
- Supabase Free : quotas de base, stockage, bande passante et **connexions temps réel simultanées** limités ; pause du projet après une période d'inactivité.
- SMTP gratuit : quota quotidien limité.
- Web Push : gratuit, sans quota de notre côté ; dépend des services de push des navigateurs.
- Vérifier les limites en vigueur au moment du déploiement.
