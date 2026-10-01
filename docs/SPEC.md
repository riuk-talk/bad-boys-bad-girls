# SPEC — Bad Boys & Bad Girls (v6.1)

> v6.1 : intègre les décisions de Phase 0 (`docs/PHASE0-DECISIONS.md`). Nom de domaine provisoire : `[DOMAINE]`.

## 0. Priorités

Tout est **P0** (indispensable au lancement), sauf les éléments marqués **[P1]** : ils sont construits après l'audit final, en Phase 8, uniquement si le porteur du projet le valide. Objectif : ouvrir la première ville vite, puis améliorer avec de vrais retours.

## 1. Positionnement

- Cible : adultes (18+) **qu'on a toujours trouvés « trop »** : trop francs, trop tatoués, trop libres, trop nocturnes, trop entiers. Moto, rock/rap, vie nocturne, goût du risque, anticonformisme. Formulation à utiliser dans la landing : « Pour ceux qu'on a toujours trouvés trop. »
- « Bad » = une attitude et une esthétique, **jamais** de la toxicité. Le site valorise la franchise et l'audace, et sanctionne le harcèlement, le contrôle et le mépris.
- Différenciation : pas de swipe, pas de match classique. On aborde quelqu'un en **plaidant** sur son **Casier**. Le premier message a donc toujours du fond.
- **Ici, c'est toi le juge.** Celui ou celle qui reçoit une plaidoirie décide seul·e : libérer ou classer l'affaire, fermer le Parloir quand il/elle veut. Ce rôle est le cœur de la promesse faite aux femmes, et il doit être visible dans toute l'interface (le mot « Juge » apparaît dans l'onglet des plaidoiries reçues).
- Univers judiciaire **léger et cartoon** : tampons, toise, dossiers. Jamais d'imagerie carcérale réaliste (barreaux, menottes, uniformes).
- **Interdit absolu** : aucun nom, logo, blason, écusson ou insigne d'une administration réelle (Police nationale, Gendarmerie, Ministère de la Justice, Marianne, drapeaux officiels, polices étrangères). Les tampons et en-têtes utilisent uniquement la marque « Bad Boys & Bad Girls ».
- L'univers habille le **décor** (en-têtes, tampons, fonds), jamais les **échanges** : dans le Parloir, les messages affichent les pseudos, pas des rôles (« Interrogateur », « Sujet »).
- Aucun terme hérité des autres applis dans l'UI : ni « match », ni « swipe », ni « like ».
- Lancement : France, ville par ville (Var et Alpes-Maritimes en premier), architecture prête pour l'international.

## 1 bis. Références visuelles (retenues des maquettes)

- **Palette unique, celle du logo** : noir `#0E0E10`, or `#D4A437`, rouge `#E0233F`, crème `#F2E8D5`. Pas de rose néon ni d'orange comme couleurs principales. Un seul logo (le monogramme BB couronne/cornes) : aucun autre emblème (tête de mort, tampon « Bad Boy × Bad Girl »).
- **La Fiche façon dossier** : carte papier crème légèrement vieilli, bandeau noir en en-tête avec le pseudo en Anton, numéro de dossier (dérivé de l'identifiant, ex. `BB-0427`), trombone décoratif, sections titrées en capitales (Signes distinctifs, Chefs d'accusation, Bio).
- **Mobile d'abord** : sur téléphone, la Fiche est verticale (photo sur toise en haut, puis le dossier en dessous). La mise en page en paysage est réservée aux écrans ≥ 1024 px. Corps de texte ≥ 16 px.
- **Tampon « RÉGLO »** : cercle ou écusson à double contour, encre légèrement irrégulière, incliné de quelques degrés. Même style pour « COUPABLE », « LIBÉRÉ·E », « AFFAIRE CLASSÉE ».
- Les visuels générés par IA (visages) ne servent qu'aux maquettes ; en marketing, ils portent la mention « Illustration » et ne sont jamais présentés comme des membres.

## 2. Principes non négociables

1. **Un site de rencontre vide est un site mort.** Tout ce qui aide à atteindre une masse critique locale passe avant les fonctionnalités secondaires (§3).
2. **Sans femmes à l'aise, le site meurt.** Chaque arbitrage protège d'abord la personne sollicitée, pas celle qui sollicite.
3. **Minimisation des données (RGPD art. 5)** : on ne collecte que ce qui sert une fonction visible.
4. **Rien n'est public.** Aucune Fiche n'est visible sans être connecté, aucune page de l'application n'est indexée par les moteurs de recherche.

## 3. Lancement ville par ville

- Configuration `launch_zones` (admin) : chaque zone = une ville + un rayon + un fuseau horaire, un statut `waitlist` ou `open`, un seuil d'ouverture (ex. 150 Fiches complètes, dont au moins 40 % de femmes : paramétrable).
- Hors zone ouverte : l'inscription et la Fiche fonctionnent, mais l'utilisateur voit une page **« Ta ville ouvre bientôt »** avec la jauge de progression de sa ville (nombre de Fiches / seuil) et son **lien de parrainage** (« Fais entrer tes complices »).
- **Fiche complète** (pour le seuil) = onboarding terminé **et** photo principale validée par la modération.
- La zone d'un membre est déterminée par sa ville (zone la plus proche dont le rayon contient la commune). Quand l'admin crée ou modifie une zone (centre, rayon), la zone de **tous les membres concernés est recalculée**.
- Quand le seuil est atteint : l'admin ouvre la zone (ou ouverture auto si l'option est activée) et un e-mail prévient les membres de la zone.
- Mode `launch_mode = open` global disponible pour désactiver ce mécanisme.
- Parrainage : lien unique par membre, compteur visible sur son profil (« 3 complices recrutés »), aucune récompense financière.

## 4. Parcours utilisateur

1. **Landing** (seule page indexée) : logo 3D, promesse, les 3 étapes (Remplis ta Fiche → Plaide → Parloir), la Charte « Bad, pas toxique », S'inscrire / Se connecter. Aucune fausse donnée, aucun faux témoignage.
2. **Inscription** (e-mail + mot de passe, ou lien magique) + Turnstile.
3. **Onboarding court** (objectif : moins de 5 minutes, sauvegarde et reprise à chaque étape) :
   1. Date de naissance + attestation 18+ + acceptation CGU
   2. Pseudo, genre, ville
   3. Qui tu cherches (genres + tranche d'âge) avec le consentement art. 9 (voir §10)
   4. 1 photo minimum (visage visible)
   5. Le Casier
   6. **10 questions** du QCM (le socle, voir §9)
   - La contrainte 18+ porte sur la **Fiche** : le compte d'authentification existe avant la saisie de la date de naissance, mais une Fiche sans date de naissance valide (≥ 18 ans, vérifiée en base) n'est visible nulle part et ne peut rien faire. Les comptes dont l'onboarding n'est pas terminé sont supprimés après 30 jours.
4. La Fiche est « en attente de modération » jusqu'à la validation de la photo principale. En attendant, l'utilisateur peut compléter sa Fiche (présentation, signes distinctifs, autres photos, 10 questions restantes) : une jauge « Fiche complète à X % » l'y encourage. Une Fiche en attente de modération **ne peut pas plaider** et n'apparaît nulle part.
5. **L'Audience du soir** (et la Découverte en secondaire) → Fiche publique → **Plaidoirie** → la personne **libère** ou **classe l'affaire** → **Parloir**.

## 5. La Fiche

- Pseudo (3–20 caractères, unique ; e-mails, téléphones et liens refusés).
- Âge (calculé depuis la date de naissance, date jamais affichée), ville (pas d'adresse, pas de GPS).
- Genre : `homme`, `femme`, `non-binaire`, `autre`. Genres recherchés : multi-sélection. **Pas de champ « orientation »** : les genres recherchés suffisent au fonctionnement (minimisation).
- Photos : 1 à 6. La première est la « photo d'identité » : visage visible obligatoire, affichée sur un fond de toise (lignes 120–200). Pas de nudité.
- **[P1] Option « Alignement 3 poses »** (disponible à partir de 3 photos validées) : si le membre coche l'option, ses 3 premières photos s'affichent en triptyque (face au centre, deux photos plus petites de chaque côté), façon photo signalétique. Sinon, galerie classique.
- Présentation : 500 caractères max (facultative à l'inscription).
- Signes distinctifs (max 5), liste configurable en base (`tribes`) : Biker, Tatoué·e, Noctambule, Rockeur·se, Rap dans le sang, Street, Tête brûlée, Fêtard·e, Voyageur·se, Sport extrême, Gamer, Franc-parler.
  - Chaque signe peut recevoir **une précision facultative** (60 caractères) : « Tatoué·e — dragon sur la nuque », « Biker — Kawasaki Z650 café racer ». Affichage : le signe en gras, la précision à la suite. Les précisions alimentent aussi le Souffleur.
- La date de naissance, le nom réel et la taille exacte ne sont **jamais** affichés (seulement l'âge).
- Indice de complicité avec le visiteur + les 3 principaux points communs du QCM.
- Badges : **Réglo**, **[P1]** « Complices recrutés ».
- Actions : **Plaider**, **Signaler**, **Bloquer**.
- Statut de disponibilité réglé par le propriétaire (§7) : « Ouvert aux plaidoiries » / « Parloir complet ».
- **Mettre ma Fiche en pause** : la Fiche disparaît de l'Audience et de la Découverte, les plaidoiries en attente restent, les conversations continuent. En pause, on **ne plaide pas** et on **ne reçoit pas d'Audience** ; on peut traiter ses plaidoiries reçues et utiliser le Parloir. Réactivation en un clic. Après 30 jours de pause, les chemins des photos publiques sont renouvelés (voir §11).
- **Exception de visibilité** : on peut toujours ouvrir la Fiche d'une personne avec qui on a une conversation ou une plaidoirie en cours, même si elle est en pause ou inactive. Le blocage reste prioritaire.
- **Fiches inactives** : sans connexion depuis 21 jours → retirée de l'Audience et affichée en fin de Découverte ; depuis 90 jours → masquée partout, e-mail « Ta Fiche est en veille » avec lien de réactivation. Plaider auprès de fantômes est la frustration à éviter.

## 6. Le Casier

- 3 « chefs d'accusation », 120 caractères max chacun ; l'auteur coche lequel est **faux**.
- Ton : aveux drôles et personnels. Exemples :
  - « A déjà traversé l'Espagne en moto sans réserver une seule nuit »
  - « A un tatouage dont il/elle refuse d'expliquer le sens »
  - « S'est fait virer d'un karaoké pour avoir chanté trop fort »
- **Assistant de Casier** (obligatoire : écrire 3 aveux drôles est difficile, surtout pour ceux qui ne savent pas quoi dire) :
  - une banque d'au moins 60 amorces à trous, classées par thème (voyage, soirée, moto, amour, enfance, travail, bêtises) : « A déjà ___ sans ___ », « S'est fait ___ pour avoir ___ », « N'a jamais avoué à personne ___ » ;
  - bouton « Autre idée » pour en tirer une nouvelle au hasard ;
  - écriture libre toujours possible ;
  - un aperçu montre le Casier tel que les autres le verront.
- Qualité : un Casier trop court (moins de 25 caractères par ligne) affiche un conseil, sans bloquer.
- **Règle du jeu** : chaque ligne est un **fait** précis sur sa propre vie (quelque chose qui est arrivé ou pas), sinon il n'y a rien à deviner.
- **[P1] Clichés déconseillés** : une liste en base (`casier_cliches`, FR + EN) détecte les formules génériques et affiche « Ça, tout le monde peut l'écrire. Donne un vrai fait, vrai ou faux. », avec une amorce proposée à la place. Liste de départ : « vol de cœur(s) », « excès de charme », « trop beau / trop belle », « séduction non autorisée », « briseur / briseuse de cœurs », « coupable d'être moi-même », « tapage nocturne » (sans détail), « récidiviste de l'amour ». Conseil non bloquant.
- **Interdit** (écrit dans l'UI et les CGU) : vrais délits, violence, drogues, références à des mineurs, coordonnées. Un filtre par mots-clés (FR + EN, table `moderation_keywords`) **signale** le texte à la modération sans le bloquer automatiquement.
- Modifier le Casier ne supprime pas les plaidoiries en cours ; elles affichent « Casier modifié depuis ». Chaque plaidoirie **enregistre une copie** des 3 lignes et de l'index du faux au moment de l'envoi : le résultat « Bien vu / Raté » reste juste même si le Casier change ensuite.

## 7. La Plaidoirie (remplace le match)

### Envoi
- « Plaider » ouvre une modale : les 3 chefs d'accusation, le visiteur désigne celui qu'il pense **faux**, puis écrit un message d'accroche (optionnel, 280 caractères max). **Le Souffleur** propose 3 accroches cliquables et modifiables.
- Après l'envoi : révélation animée « Bien vu ! » ou « Raté ! » (bonus fun, sans effet bloquant).

### Limites appliquées en base (fonction SQL `send_plea`, jamais seulement côté client)
- **Expéditeur** : 5 plaidoiries par 24 h glissantes.
- **Couple** : 1 plaidoirie en cours maximum par expéditeur → destinataire ; 30 jours d'attente après un classement, **dans le sens expéditeur → destinataire uniquement** (le destinataire reste libre de plaider auprès de l'expéditeur). Le classement automatique à 7 jours compte pour ce délai.
- **Destinataire** : chaque membre fixe un plafond de plaidoiries en attente (défaut 15, réglable de 5 à 50). Plafond atteint → sa Fiche passe automatiquement en « Parloir complet » : elle reste visible, mais le bouton Plaider est désactivé jusqu'à ce qu'il/elle traite ses plaidoiries. Il/elle peut aussi se mettre en « Parloir complet » manuellement.
- Refus si : expéditeur dont la photo principale n'est pas validée ou dont la Fiche est en pause, blocage dans un sens ou dans l'autre, Fiche du destinataire non visible, critères de genre et d'âge non réciproques.
- **Anti-arnaque** : 3 messages d'accroche identiques ou quasi identiques envoyés par le même compte sur 7 jours → signalement automatique à la modération (sans blocage). Normalisation : minuscules, sans accents ni ponctuation, espaces réduits, coordonnées masquées ; « quasi identique » = similarité trigramme ≥ 0,9 ; messages vides exclus. Compte de moins de 24 h limité à 2 plaidoiries.

### Plaidoiries croisées
- Si A plaide auprès de B alors que B a déjà une plaidoirie en attente auprès de A → **libération automatique mutuelle**, animation spéciale « Coupables tous les deux », ouverture directe du Parloir.
- Une plaidoirie croisée passe **même si B est en « Parloir complet »** (elle libère au lieu d'ajouter une plaidoirie en attente). Les autres limites (5/24 h, blocage, réciprocité, délai de 30 jours) s'appliquent.

### Réception
- Onglet « Le Juge, c'est toi » (plaidoiries reçues) : Fiche de l'expéditeur, indice de complicité, bonne/mauvaise réponse, message.
- **Libérer** → crée la conversation, animation tampon « LIBÉRÉ·E », notification à l'expéditeur.
- **Affaire classée** → l'expéditeur reçoit un message neutre et respectueux prédéfini (« Affaire classée. Pas de suite cette fois — bonne route. »). Jamais de silence.
- Sans réponse sous 7 jours → classement automatique avec le même message.
- **Conseils après 3 affaires classées de suite** (les classements automatiques à 7 jours ne comptent pas) : l'expéditeur voit des conseils concrets tirés de sa propre Fiche (photo principale seule, Casier court, QCM incomplet, plaidoiries sans message), jamais de reproche. Les statistiques des autres membres ne sont jamais montrées.

## 8. Le Souffleur

- Génération **sans IA et sans API**, 100 % locale (`lib/prompter`), à partir de modèles de phrases.
- Entrées : réponses QCM des deux personnes, signes distinctifs communs.
- Trois accroches, une par type :
  - Point commun : « On a tous les deux répondu "{réponse}" à "{question}". Raconte-moi la dernière fois. »
  - Désaccord : « Toi "{réponseA}", moi "{réponseB}" sur "{question}". Je plaide coupable, mais j'ai des arguments. »
  - Signe distinctif : « {Tribu} aussi. Ta meilleure histoire en 2 lignes, je te donne la mienne. »
- Au moins 10 modèles par type, en FR et EN dans les fichiers de messages ; choix aléatoire sans répétition immédiate.
- Si les données manquent (moins de 5 questions communes), le Souffleur propose des accroches génériques liées au Casier.

## 9. Le QCM et l'indice de complicité

### Mécanique (inspirée d'OkCupid)
Pour chaque question :
- **sa réponse** (une option) ;
- **les réponses acceptées chez l'autre** : par défaut « toutes » (un tap pour restreindre) ;
- **l'importance** : `peu` (poids 1), `important` (10, valeur par défaut), `indispensable` (50).

Calcul pour A et B sur les questions répondues par les deux (minimum 5, sinon « Pas encore assez d'indices ») :
- `satisfaction(A→B) = Σ poids_A des questions où la réponse de B ∈ acceptées_A / Σ poids_A`
- `indice = sqrt(satisfaction(A→B) × satisfaction(B→A))`, affiché en % arrondi.
- Une question « indispensable » non satisfaite dans un sens plafonne l'indice à 50 % (le deal-breaker se voit).
- Implémenté en SQL (`complicity_score`) **et** en TypeScript pur (`lib/complicity.ts`), avec tests de parité (mêmes cas, mêmes résultats).
- **Calculé à la volée** sur l'ensemble déjà filtré de la Découverte et de l'Audience (pas de table de cache au MVP). N'ajouter un cache que si les mesures de la Phase 7 le justifient.

### Les 20 questions (seed FR ; traductions EN à produire)
Les **10 premières** sont demandées à l'inscription (le socle) ; les 10 suivantes sont proposées ensuite.

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

Visibilité : les réponses d'un membre ne sont jamais affichées en liste complète ; seuls les 3 points communs (réponses identiques, triées par importance cumulée) et les réponses utilisées par le Souffleur sont montrés, à un visiteur connecté autorisé à voir la Fiche.

UI : une question par écran, réponse en un tap, « acceptées » et « importance » repliés sous un lien « Affiner » (valeurs par défaut sinon). Tables : `questions`, `question_options`, `answers`. Libellés traduits en JSON `{fr, en}`. Banc de questions optionnelles gérable par l'admin.

## 10. Conformité, sécurité, vie privée

> Les textes juridiques générés sont des **modèles** marqués `[À FAIRE VALIDER PAR UN JURISTE]`. Ne jamais les présenter comme définitifs.

### Âge (18+)
- Date de naissance obligatoire ; refus si < 18 ans **par contrainte/trigger Postgres**, pas seulement côté client. Critère : impossible d'avoir une Fiche utilisable avec un âge < 18 ans, même via l'API (voir §4).
- Attestation « J'ai 18 ans ou plus » obligatoire, horodatée.
- Signalement « mineur » : traitement prioritaire. Masquage automatique immédiat si **2 signalements distincts** ou 1 signalement d'un membre Réglo (évite qu'un seul signalement malveillant suffise à masquer quelqu'un).

### RGPD
- **Genres recherchés = donnée révélant l'orientation sexuelle (art. 9)** : case de consentement explicite, séparée, non pré-cochée, sur l'écran « Qui tu cherches », avec un texte clair sur l'usage (proposer des profils compatibles, rien d'autre). Sans ce consentement, le service ne peut pas fonctionner : l'expliquer honnêtement. Retrait = suppression du compte proposée.
- Table `consents` historisée (type, version du texte, date, IP tronquée ; jamais écrasée).
- Pages : Politique de confidentialité, CGU, Mentions légales (éditeur et hébergeurs), Charte « Bad, pas toxique ». Placeholders `[À COMPLÉTER]`.
- Paramètres : **export de mes données** (JSON : ses propres messages sans le texte de l'autre personne, ses plaidoiries envoyées/reçues avec le seul pseudo de l'autre, ses réponses QCM, consentements, signalements faits sans données de la cible, notifications) et **suppression du compte** (suppression réelle en cascade + fichiers Storage, confirmation par mot de passe ou lien e-mail).
- Suppression du compte : les messages de la personne supprimée sont **effacés en base** et remplacés par « Message supprimé » ; la conversation reste visible pour l'autre avec « Ce compte a été supprimé ».
- Conservation après bannissement : uniquement l'empreinte (HMAC-SHA256 avec poivre secret, e-mail en minuscules sans espaces, sans normalisation des alias `+` ni des points) de l'e-mail, vérifiée par le hook d'authentification « Before User Created », pour empêcher la réinscription, durée paramétrable (défaut 12 mois) `[À FAIRE VALIDER PAR UN JURISTE]`.
- Pas de traceur tiers ni d'analytics externe → cookies strictement nécessaires uniquement, pas de bandeau (le préciser dans la politique).
- Localisation : ville seulement ; distance calculée depuis le centre de la commune (référentiel communes FR en seed ; structure `places` prête pour d'autres pays). Jamais de GPS appareil.
- Photos : **suppression des métadonnées EXIF** (dont la position GPS) par ré-encodage côté client **et** contrôle côté serveur.
- `noindex, nofollow` + `robots.txt` sur tout sauf la landing, les pages légales et la Charte ; aucune Fiche accessible sans session.

### DSA / modération
- **Signaler** sur Fiche, photo, Casier et message ; catégories : faux profil, mineur, harcèlement, contenu sexuel, violence ou menace, arnaque, autre ; commentaire optionnel.
- **Bloquer** : effet immédiat et bidirectionnel (invisibles l'un pour l'autre, plaidoiries annulées, conversation fermée), appliqué dans la RLS.
- File de modération admin, décision motivée ; le signaleur **et** la personne sanctionnée reçoivent l'exposé des motifs.
- Point de contact visible dans les mentions légales.

### Sécurité technique
- RLS activée sur **toutes** les tables, refus par défaut ; politiques testées avec **pgTAP** (`supabase test db`).
- Rôle admin dans une table séparée `admin_users`, **non modifiable** par les utilisateurs (aucune politique d'écriture) ; premier admin créé par un script SQL documenté.
- Colonnes sensibles de `profiles` (statut de modération, badge Réglo, bannissement) non modifiables par l'utilisateur : politique d'update limitée aux colonnes éditables ou fonction dédiée.
- Server Actions : authentification vérifiée + Zod + limites en base.
- En-têtes : CSP stricte, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictive.
- Turnstile à l'inscription et à la connexion.
- Pseudo, présentation, Casier, plaidoiries : e-mails, numéros de téléphone et liens masqués (anti-arnaque).
- Dans le Parloir, le masquage est **levé** dès qu'une Cavale est acceptée ou que les deux personnes ont chacune envoyé au moins 10 messages, **à condition** que les deux comptes aient plus de 7 jours et qu'aucun signalement ne soit ouvert entre eux ni contre l'un d'eux : échanger son numéro doit rester possible pour se voir. À ce moment, un encart rappelle : « Ne partage jamais d'argent ni de codes. »
- Aucune clé secrète dans le client ; `.env.example` documenté.

## 11. Photos et modération d'images

- Compression côté client avant envoi : WebP, deux tailles (1200 px ≈ 180 Ko max, 400 px ≈ 30 Ko max). Vignettes partout sauf sur la Fiche ouverte. Bibliothèque chargée en `dynamic import` sur l'écran d'upload uniquement.
- Upload dans le bucket **privé** `photos-pending` → **file de validation admin** (critères : adulte, visage visible sur la photo principale, pas de nudité, pas de coordonnées) → copie vers le bucket **public** `photos` sous un chemin UUID non devinable. Refus → suppression + motif notifié.
- Les fichiers de `photos-pending` sont supprimés dès la décision. Fichiers publics servis avec un `Cache-Control` long (chemins immuables).
- **Rotation de chemin** (nouvel UUID, ancien fichier supprimé) à la suppression d'une photo, après 30 jours de pause, au bannissement ; purge totale à la suppression du compte. Mentionné dans la politique de confidentialité.
- **Seuil de bascule** : alerte dans le tableau de bord admin quand le stockage dépasse 700 Mo ou l'egress dépasse 3,5 Go/mois deux mois de suite. La décision de payer reste humaine.
- Pas de détection automatique au MVP (un modèle côté client est lourd et contournable ; la validation humaine fait foi au volume du lancement). Prévoir l'emplacement d'un contrôle automatique pour plus tard.
- Notification admin (e-mail groupé) dès qu'il y a des photos en attente ; objectif de validation < 12 h, affiché à l'utilisateur.
- Pas d'optimisation d'image Vercel (quota limité en Hobby) : `next/image` avec `unoptimized`, `width`, `height`, `sizes`, `loading="lazy"` hors de la zone visible.

## 12. L'Audience du soir (écran d'accueil principal)

- Chaque jour à **21 h** (heure locale de la zone), chaque membre reçoit **sa sélection de 5 Fiches**, choisies pour lui.
- But : créer un rendez-vous quotidien (les membres sont en ligne en même temps, donc les réponses sont plus rapides) et donner une impression de rareté et de soin, ce qui compte encore plus quand la base est petite.
- Sélection (fonction SQL `build_daily_hearing`, exécutée par la tâche planifiée) :
  - Fiche validée par la modération, ni en pause ni inactive, pas en « Parloir complet », réciprocité genre/âge, zone ouverte, pas de blocage, pas de plaidoirie ni conversation déjà échangée, pas déjà proposée dans les 14 derniers jours ;
  - classement : indice de complicité, activité récente, puis **répartition de l'attention** : une Fiche déjà très sollicitée (plaidoiries en attente > 50 % de son plafond) apparaît dans moins de sélections, pour que l'attention se répartisse ;
  - formule : score = indice de complicité (0–100, 0 si inconnu) + bonus d'activité (0–20), multiplié par 0,5 au-delà de 50 % du plafond ; une Fiche apparaît dans **au plus 10 Audiences par jour** (paramétrable) ;
  - s'il y a moins de 5 candidats, afficher ceux qui existent, sans remplissage.
- **Génération à l'avance, révélation à l'heure** : la tâche planifiée tourne dans l'heure qui précède (les tâches planifiées gratuites ne sont pas précises à la minute) et enregistre les sélections avec `visible_from = 21:00` ; l'application ne les montre qu'à partir de cette heure. Un membre inscrit après la génération reçoit sa première sélection à la génération suivante (en attendant : la Découverte).
- Calcul en SQL ensembliste (pas de boucle par paire). Critère : génération pour 5 000 membres dans une même zone en moins de 5 minutes.
- Heure calculée avec le fuseau horaire de la zone (`launch_zones.timezone`), dates stockées en UTC.
- La sélection reste disponible jusqu'au lendemain 21 h. Notification « L'audience est ouverte » in-app. **Pas d'e-mail quotidien** (le quota SMTP gratuit ne le permet pas) : e-mail hebdomadaire facultatif, désactivé par défaut.
- Le compte à rebours jusqu'à la prochaine audience est affiché quand la sélection du jour est vue en entier.

## 12 bis. Découverte (secondaire)

- Accessible uniquement connecté, dans une zone ouverte, depuis un onglet secondaire. Montre les Fiches de **toutes les zones ouvertes**, filtrées par distance (« France » = toutes). L'Audience du soir reste l'expérience principale.
- Grille de Fiches, filtres : tranche d'âge, distance (10/25/50/100 km/France), signes distinctifs, « Réglo uniquement », « actif récemment ».
- Réciprocité obligatoire (genre + âge dans les deux sens).
- Tri par défaut : indice de complicité, puis activité récente. Les Fiches « Parloir complet » sont affichées en fin de liste.
- Pagination par curseur (24 par page), une seule requête SQL (fonction `discover_profiles`), exclusion des bloqués et des Fiches non modérées.
- État vide soigné : « Personne de nouveau dans ton coin pour l'instant » + élargir les filtres + lien de parrainage.

## 13. Le Parloir

- Ouvert seulement après une Libération.
- Texte uniquement au MVP, 1 000 caractères max par message.
- **Le champ de saisie est toujours visible** en bas de l'écran ; les actions (Cavale, Classer l'affaire, Signaler, Bloquer) sont dans l'en-tête ou un menu, jamais à la place du champ.
- **Proposer une Cavale** (rendez-vous réel) : bouton dans l'en-tête du Parloir. Formulaire : type de lieu (bar, café, concert, balade, activité), nom du lieu (texte libre), date et heure. L'autre personne répond **Accepter**, **Proposer autre chose** (contre-proposition) ou **Pas encore**. Une Cavale acceptée s'affiche en carte épinglée en haut de la conversation, avec le rappel des conseils sécurité. Une seule Cavale en attente par conversation. Si le lieu saisi contient « chez moi », « chez toi » ou une adresse privée, un avertissement conseille un premier rendez-vous dans un lieu public (conseil, pas blocage).
- **[P1] Relance à 48 h** (pas de fermeture automatique) : si une conversation est ouverte depuis 48 h sans Cavale proposée et que le dernier message a plus de 24 h, un bandeau discret apparaît pour les deux : « Toujours là ? Propose une Cavale ou classe l'affaire. » Une seule relance par conversation.
- Temps réel avec Supabase Realtime (canal par conversation, RLS respectée), **ouvert seulement quand une conversation est affichée**. Les compteurs (non-lus, plaidoiries, cloche) sont mis à jour par simple interrogation toutes les 60 s et au retour sur l'onglet. Raison : l'Audience du soir met tout le monde en ligne au même moment, et l'offre gratuite limite le nombre de connexions temps réel simultanées. Repli propre si la connexion tombe.
- Indicateur « lu », liste triée par activité, compteur de non-lus.
- Anti-spam : 30 messages par minute max (fonction SQL).
- « Classer l'affaire » : termine la conversation avec le message neutre prédéfini ; plus d'envoi possible ; même délai de 30 jours avant une nouvelle plaidoirie entre ces deux personnes.
- Compte supprimé : la conversation reste visible pour l'autre personne, avec « Ce compte a été supprimé », sans pseudo ni photo ; ses messages sont effacés en base et affichés « Message supprimé ».
- Signaler / Bloquer dans l'en-tête de la conversation.
- Encart discret « Premier rendez-vous : lieu public, préviens un proche » avec lien vers la page Conseils sécurité.

## 14. Badge Réglo

- Calcul quotidien : compte de plus de 30 jours, au moins 3 conversations avec des réponses, aucun signalement retenu.
- Retiré immédiatement si un signalement est retenu.
- Infobulle explicative sur la Fiche.

## 15. Administration et pilotage

- `/admin` (réservé à `admin_users`) : file photos, file signalements, textes signalés par mots-clés, recherche d'utilisateur, suspension/bannissement (motif obligatoire), historique des décisions, gestion des `launch_zones`, des tribus, des mots-clés et des questions.
- **Tableau de santé par zone** (calculé depuis nos propres tables, sans outil tiers) :
  - inscrits, Fiches complètes, **répartition femmes/hommes/autres** (l'indicateur n° 1 d'un site de rencontre) ;
  - plaidoiries envoyées/jour, taux de libération, délai moyen de réponse ;
  - part des plaidoiries classées automatiquement (trop élevée = membres inactifs ou submergés) ;
  - rétention J7 et J30 ;
  - volume de signalements et délai de traitement ;
  - Cavales proposées et acceptées (le vrai indicateur de réussite : des gens qui se voient) ;
  - les Fiches `is_seed` sont exclues de tous les chiffres.

## 16. Notifications

- In-app : cloche + compteurs (plaidoirie reçue, libération, affaire classée, nouveau message, Cavale proposée/acceptée/contre-proposée, Audience ouverte, décision de modération, ouverture de ta ville).
- E-mail (SMTP gratuit, quota limité) : plaidoirie reçue et libération (regroupées, maximum 1 e-mail par jour et par membre), Cavale acceptée, ouverture de la ville, Fiche en veille ; désinscription par type. Si le quota du jour est atteint, les e-mails restants passent au lendemain.

## 17. Accessibilité et UX

- WCAG AA : contrastes, navigation clavier complète, focus visible, libellés sur tous les champs, `aria-live` pour les notifications.
- `prefers-reduced-motion` : les animations de tampon deviennent un simple fondu.
- Écriture inclusive avec point médian dans l'UI ; ajouter un `aria-label` sans point médian quand la lecture par lecteur d'écran devient gênante.
- Tous les états sont conçus : chargement (squelettes), vide, erreur, hors ligne.

## 18. Performance (critères d'acceptation)

- Lighthouse mobile ≥ 90 en Performance, Accessibilité et Bonnes pratiques sur la landing, l'Audience du soir, la Découverte, une Fiche et le Parloir.
- LCP < 2,5 s, CLS < 0,1, INP < 200 ms ; JS initial de la landing < 130 Ko compressé.
- Server Components par défaut ; bibliothèques lourdes en `dynamic import`.
- Index SQL sur toutes les colonnes filtrées ou triées ; pas de requêtes N+1 ; `EXPLAIN ANALYZE` de `discover_profiles` avec un jeu de 5 000 Fiches de test.

## 19. Données de test

- Un script de seed génère des Fiches **fictives** pour le développement et les tests de charge uniquement : colonne `is_seed = true`, jamais exécuté en production (garde-fou sur la variable d'environnement), visuels neutres (avatars générés, pas de photos de vraies personnes).
- Ce n'est pas une exception à « ne jamais inventer » : c'est un outil de développement, jamais montré au public.

## 20. Hors périmètre du MVP (feuille de route)

- **La Virée** : sorties de groupe réelles par ville (balade moto, concert), inscription et discussion de groupe. (Ne pas confondre avec la Cavale, qui est un rendez-vous à deux, dans le MVP.)
- Paris et Duels QCM.
- Notifications push web (PWA), photos dans le Parloir, appels vidéo.
- Vérification d'identité par selfie.
- Détection automatique des images.
- **Financement futur sans casser l'équité** (à décider plus tard, rien à coder au MVP) : billets pour les sorties de La Virée, boutique d'objets de la marque (écussons, stickers, t-shirts, très adaptés à la culture moto et tatouage). Règle à respecter dès maintenant : **jamais payer pour plaider plus, ni pour être plus visible**.

## 21. Contraintes des offres gratuites (à rappeler dans le README)

- Vercel Hobby : usage **non commercial** uniquement ; passer en Pro avant toute monétisation.
- Supabase Free : quotas de base, stockage, bande passante et connexions temps réel limités ; pause du projet après une période d'inactivité.
- SMTP gratuit : quota quotidien limité.
- Vérifier les limites en vigueur au moment du déploiement.
