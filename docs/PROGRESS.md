# PROGRESS — Bad Boys & Bad Girls

> À lire en premier à chaque session. Mis à jour à chaque étape significative.

## Phase en cours

**Phase 4 — 4a à 4f terminées, preview en attente de validation** (branche `phase-4`). 4a validée par le conseiller (relecture sécurité). Phase 3 validée et fusionnée (PR #9), en production. Liaison par l'issue #10 abandonnée (retour au relais manuel).

## Phase 4 — Demande de parloir, Promenade, Découverte, Courrier (2026-10-05)

### Découpage (validé par le porteur)
4a base + pgTAP · **arrêt relecture sécurité** · 4b Souffleur (`lib/prompter`) · 4c écrans Visiteur (Promenade, Découverte, Fiche dossier judiciaire, Demande de parloir, Mes demandes) · 4d écrans Bad (Courrier, lecture d'une demande, Accepter / Affaire classée, plafond) · 4e changement de rôle, pause, Signaler / Bloquer · 4f vérification (performance, e2e, axe, captures, preview).
Réponses du porteur : N° d'écrou 6 chiffres aléatoires, uniques, Bads seulement, jamais l'identifiant interne, aucune fonction de recherche par ce numéro ; données de test en pgTAP annulé ; onglets Visites et Parloir masqués ; notifications dans l'application seulement.

### 4b à 4f — fait (2026-10-06, vérifié)
- **4b Souffleur** (`lib/prompter`) : 3 amorces par Demande (points communs, tribu, Casier sans jamais en citer un chef, générique), « Autre idée » sans répétition immédiate, 11 modèles par famille en fr/en ; tests unitaires.
- **4c Visiteur** : barre d'onglets par rôle (Visites / Parloir masqués en Phase 4) ; **Promenade** (compte à rebours jusqu'à 21 h locale, `Europe/Paris`) ; **Découverte** (filtres par formulaire GET sans JS, pagination par curseur) ; **Fiche dossier judiciaire** (poses, chefs, N° d'écrou, complicité, Signaler / Bloquer) ; **Demande de parloir** (pari, mot facultatif ≤ 280, Souffleur, tampon « DEMANDE DÉPOSÉE ») ; **Mes demandes** (délai de 30 jours affiché, conseil après 3 refus).
- **4d Bad** : **Courrier** (liste, réglages plafond / fermeture), lecture d'une demande (Permis de visite, mot, sans jamais le chef parié ni le résultat), **Accepter la visite** (tampon vert) / **Affaire classée**.
- **4e** : changement de rôle (Motif requis pour devenir Visiteur, 7 jours entre deux), pause, Signaler / Bloquer depuis la Fiche et le Courrier, liste de mes blocages dans Ma Fiche (`get_my_blocks`), notifications in-app marquées lues par écran (`mark_notifications_read(types[])`).
- **4f performance** (données synthétiques non-seed créées dans des transactions pgTAP annulées : la base n'a aucun profil `is_seed`, et ces fonctions les excluent de toute façon) :
  - **Découverte** : 1,1 s par page sur 1 000 Bads au départ (cause : petites fonctions SQL avec `set search_path` jamais inlinées, ~0,1–0,3 ms par appel et par ligne). Conditions écrites dans la requête → **62 ms** (filtres : 10 à 37 ms). Test d'équivalence : en suivant toutes les pages, exactement les Bads autorisés par `can_view_bad` (743 sur 1 000, avec pauses, bannis, critères, photo refusée, blocages dans les deux sens).
  - **Promenade** : réécrite en 4 passes (`20261006055943` … `20261006062808`). Réponses en bitsets, lots de 500 Visiteurs, tours avec curseur par Visiteur, `work_mem` 32 Mo pour le job. **Mesuré : 600 Visiteurs × 1 000 Bads = 6,9 s** ; saturé (1 000 Visiteurs × 200 Bads, 5 demandes par place) = 2,9 s. **5 000 × 1 000 non mesuré, extrapolé linéairement ≈ 1 min** (créer 6 000 membres passe par les triggers de production, ~25 ms chacun, et le connecteur coupe un appel à 60 s). Test « même résultat que le builder 4a » : mêmes paires, rangs et scores sur 80 × 80 avec réponses sautées, < 5 questions communes, plusieurs options acceptées et blocages.
  - Bad au-dessus de la moitié de son plafond : 0 apparition contre 3,75 en moyenne pour les autres (600 × 1 000).
- **pgTAP relancé** : parité complicité 69/69 ; `phase4_relations` : les 7 groupes qui appellent une fonction modifiée (règle 14 59/59, formes 9/9, visibilité 13/13, blocages 14/14, signalement 15/15, Promenade 13/13 dont « deuxième build dans la même transaction », droits) + nouveau groupe `get_my_blocks` / `mark_notifications_read` 8/8 ; base revérifiée vide, `app_settings` inchangé.
- **App** : typecheck, lint, Prettier, **142 tests unitaires**, build ; **e2e 49/49** (9 ignorés à dessein : parcours Phase 4 une seule fois en 360 px, compte E2E manuel absent) dont les 3 parcours Phase 4 réels avec axe 0 violation ; Lighthouse landing 91 / 100 / 100 / 100, LCP 3,3 s (inchangé).

### Défauts trouvés et corrigés en 4f
1. Découverte 5× trop lente (voir ci-dessus).
2. Promenade : une première optimisation (garder les 60 meilleurs candidats par Visiteur) changeait le résultat — un Bad plein est sauté sans consommer de tour, des Visiteurs se retrouvaient sans Promenade. Corrigé (`20261006061446`), puis vérifié contre le builder 4a.
3. Promenade : CTE inlinées par le planificateur → chaque comptage de bits recalculé des dizaines de fois (7,9 s au lieu de 0,4 s) → `materialized`.
4. Test e2e Bad : 30 s trop court quand toute la suite tourne en parallèle → 120 s pour le bloc Phase 4 (comme l'onboarding, 180–240 s).

### Écarts / points à trancher
- **Encre or sur crème** `#765a0e` (5,33:1) au lieu de `#8a6a12` (4,16:1, refusé par axe) : écart à PARCOURS-DESIGN.
- **Capacité de la Promenade** (produit, pas performance) : avec un plafond de 10 apparitions par Bad et par jour, 5 000 Visiteurs pour 1 000 Bads = 10 000 places pour 25 000 demandées ; en saturé, 17 % des Visiteurs n'ont **aucun** Bad ce soir-là. À trancher par Chris : plafond plus haut, ou garantir au moins 1 Bad par Visiteur avant d'en donner 5 à d'autres.
- Anglais : Promenade = « The Yard », Courrier = « Mailbox », Casier = « Record », Parloir = « visiting room », Greffe = « Registry ».
- Limites Phase 4 : pas de créneaux de visite (Phase 5), onglets Visites / Parloir masqués, notifications dans l'application seulement.

### 4a — base (vérifié sur la base de dev)
- **Migrations** (dans l'ordre, versions enregistrées) :
  - `20261005172921_phase4_relations_tables` : types (`visit_request_status`, `case_close_reason`, `report_target`, `moderation_action_type`), `profiles.ecrou` + trigger, tables `blocks` (jamais de suppression, `unblocked_at`), `reports`, `moderation_actions` (ajout seul), `visit_requests`, `promenade_picks`, aides internes, RLS ;
  - `20261005173248_phase4_relations_functions` : `get_fiche`, `get_permit`, `discover_bads`, `get_my_promenade`, `mark_promenade_seen`, `send_visit_request`, `get_mailbox`, `decide_visit_request`, `get_my_requests`, `change_role`, `block_user`, `unblock_user`, `report` (les 13 seules appelables par un membre) ; `build_daily_promenade`, `run_promenades_due`, `expire_visit_requests` (tâches pg_cron horaires, propriétaire seulement) ;
  - 3 correctifs trouvés par les tests (voir plus bas) et `20261005190830_phase4_fk_indexes`.
- **Règle 14** : la copie du Casier, le chef parié et le résultat ne sortent d'aucune fonction. `send_visit_request` ne renvoie que l'identifiant de la demande. `get_fiche` donne les trois chefs dans l'ordre du Bad, sans marque, identiques pour tous.
- **Limites dans SQL** (une transaction, ligne du Bad verrouillée) : Visiteur avec Permis délivré, quartier ouvert, critères dans les deux sens, aucun blocage, 30 jours après une affaire classée, une demande en cours par couple, 5 par 24 h (2 si le compte a moins de 24 h), « Parloir complet », mot masqué et signalé, anti-arnaque (même mot une 3e fois en 7 jours → `flagged_texts`).
- **Promenade** : construite dans l'heure avant 21 h locale, 5 Bads au plus par Visiteur, plafond d'apparitions par Bad (`app_settings`), score × 0,5 au-delà de la moitié du plafond de demandes, jamais un Bad déjà sollicité, bloqué, de test ou vu dans les 14 jours ; notification dans l'application à 21 h.
- **pgTAP** :
  - `phase4_relations.test.sql`, 14 groupes, **tout passe** (fuite règle 14 : 59 vérifications, dont 11 qui prouvent que chaque appel autorisé renvoie bien des données ; formes exactes des réponses ; tables fermées ; N° d'écrou ; limites ; Parloir complet ; anti-arnaque ; visibilité ; blocages ; changement de rôle ; signalement ; Promenade ; droits) ;
  - `phase3_complicity_parity` 69/69 : la parité couvre maintenant aussi `complicity_with`, la version ensembliste utilisée par la Découverte et la Promenade ;
  - non-régression, tout relancé : `phase2_security` 22/22 groupes (+ `ecrou` dans les colonnes protégées), `phase3_security` 17/17, `phase3_greffe` 7/7.
  - Base vérifiée vide après les tests ; `app_settings` inchangé (`zones` / 10).
- Types TypeScript régénérés ; typecheck OK.

### Défauts trouvés par les tests de la 4a (corrigés par migration)
1. `get_mailbox` échouait pour tout Bad (colonnes `varchar` déclarées `text`) → `20261005185814_phase4_mailbox_types`. Le test de fuite seul ne l'aurait pas vu (il passait sur une erreur) : d'où les vérifications « l'appel renvoie des données ».
2. Un changement de rôle classait les demandes reçues en `dismissed` et comptait un refus au Visiteur → seuls les refus du Bad comptent (`20261005190154_phase4_dismissals_by_bad_only`).
3. `complicity_with` (Découverte, Promenade) rendait « pas de score » ou 50 au lieu de 0 quand aucune réponse n'était acceptée (somme filtrée nulle) → `complicity_from_sums` lit une somme absente comme 0 (`20261005190448_phase4_complicity_null_sums`).

### Relecture sécurité 4a (conseiller, issue #10) et corrections
- **Tranché** : demande acceptée « en cours » jusqu'à la Phase 5, hors plafond du Bad (OK) ; expiration à 7 jours hors compteur des 3 refus (OK) ; aucun rappel du chef choisi au Visiteur avant la visite (version stricte gardée) ; règle « mineur » confirmée (masquage immédiat).
- **Corrigé** (`20261005192344_phase4_report_guard`) :
  - `report()` : le signaleur doit avoir fini son inscription, et la cible doit lui être visible (`can_view_bad`), ou partager une demande avec lui (en cours ou passée), ou avoir été bloquée par lui ; sinon `not_found`, la même réponse qu'un identifiant inconnu ;
  - règle « mineur » : ne comptent que les signaleurs dont la photo est validée par le Greffe et dont le compte a plus de 7 jours ; un Bad « Bonne conduite » suffit seul ;
  - `can_report` et `is_trusted_reporter` sont internes (aucun droit pour les membres).
- pgTAP `test_report` 15/15 : signaler un Visiteur ou un Bad invisible → refusé ; inscription non terminée → refusé ; Bad → Permis d'un Visiteur qui lui a écrit → accepté, d'un autre → refusé ; membre bloqué → accepté ; 2 signalements « mineur » de comptes non validés (moins de 7 jours, sans photo validée) → rien n'est masqué ; 2 comptes établis → masqué ; Bad « Bonne conduite » seul → masqué.
- Reporté en Phase 7 : le cas « mineur » en tête de la file admin.

## Phase 3 — QCM, indice de complicité, Casier, Greffe (2026-10-05)

### Découpage
3a base (QCM, Casier, onboarding en 8 étapes) · 3b indice de complicité · **arrêt relecture sécurité (validée)** · 3a-bis corrections de la relecture + `docs/PARCOURS-DESIGN.md` côté base (Casier distinct, 3 poses, notifications, fonctions du Greffe) · 3a-ter `SIGNUPS_OPEN`, contenus, docs · 3c couleurs par genre + L'Interrogatoire · 3d « Passe à la toise », Casier, « Teste ton Casier », liste des mots-clés · 3e le Greffe pose par pose · 3f vérification.

### Fait après la relecture (2026-10-05, vérifié)
- **Base** (migration `20261005125805_phase3_poses_greffe`) : deux chefs d'accusation identiques (casse et espaces ignorés) refusés ; `complete_onboarding` exige les positions 0, 1, 2 pour un Bad (0 seule pour un Visiteur) ; un Bad compte pour le quartier quand ses **3 poses sont validées** ; table `notifications` (écrite par SQL seulement) ; `admin_photo_queue` et `admin_decide_photo` (une décision par photo, motif de refus dans une liste, publication sous un nom UUID aléatoire) ; anglais Q1/Q15 corrigé.
- **pgTAP** : `phase3_greffe` 7 groupes **27/27** ; `phase3_security` 16 groupes (+ chefs distincts, 3 poses) ; `phase2_security` adapté (3 poses), **tout passe** ; base vide après les tests.
- **`SIGNUPS_OPEN`** : `false` sur Vercel Production (« Inscriptions bientôt ouvertes », inscription refusée côté serveur, lien magique sans création de compte), `true` en Preview et en local.
- **Couleurs = genre** (PARCOURS-DESIGN §1) : accent de l'interface = genre du membre connecté (or / rouge `#EE3A55` / crème) ; étiquette « BAD » (barreaux) / « VISITEUR » (combiné) dans l'en-tête ; landing : portes, sur-titres, titres de section, blocs « Côté Bad / Côté Visiteur » et boutons finaux en crème ; jauges du quartier : bad girls en rouge, bad boys en or.
- **Onboarding en 8 étapes** : Bad 5 « Passe à la toise » (3 emplacements, chaque photo envoyée dès qu'elle est choisie, « Déposer au Greffe » refusé s'il manque une pose), 6 assistant du Casier (le vrai puis deux faux, 7 thèmes, 60 amorces, « Autre idée », doublons refusés), 7 « Teste ton Casier » (ordre mélangé, « Le vrai · visible par toi seul », conseils du Souffleur, alerte ± 40 % de la moyenne des deux autres), 8 **L'Interrogatoire** pour les deux rôles (une question par écran, « Affiner » replié en `<details>` natif).
- **Après l'onboarding** : `/interrogatoire` (les 20 questions, le socle modifiable, les 10 suivantes), `/mon-casier` (+ aperçu), Ma Fiche avec les 3 poses (statut par pose, motif de refus), photos supplémentaires 3 à 5, Casier sur l'aperçu, **nouvelles du Greffe** (« Compris » les marque lues).
- **Le Greffe** `/admin/greffe` (admins seulement, lien dans l'en-tête) : file par priorité, une carte par photo, Valider / Refuser avec motif ; copie vers le bucket public sous un nom aléatoire puis suppression des fichiers en attente.
- **Contenus à relire** : `docs/content/moderation-keywords.md` (liste de départ, rien en base).

### Vérifications 3f
- typecheck, lint, **105 tests unitaires** (dont équilibre ± 40 % et cas limites, doublons, ordre mélangé, namespaces client), build.
- **e2e : 47/47** (360 et 1440 px) : les deux onboardings réels en 8 étapes (axe 0 violation sur les nouveaux écrans), puis le Greffe (2 poses validées, 1 refusée : fichiers publics sous un nom aléatoire sans EXIF, fichiers en attente supprimés, nouvelles du Greffe) ; comptes et fichiers supprimés, base revérifiée vide.
- **Lighthouse landing** : 92 / 100 / 100 / 100, LCP 3,3 s (inchangé, tolérance 3,5 s) ; la landing n'a reçu que du CSS (aucun JS ajouté).
- Captures (390 px et Greffe en 1280 px) : « Passe à la toise », Casier, « Teste ton Casier », L'Interrogatoire avec « Affiner », Greffe, landing.

### Défauts trouvés et corrigés pendant la 3f
1. Le namespace « Interrogation » n'était pas envoyé aux composants client (clés brutes affichées) → ajouté + test unitaire qui vérifie chaque namespace utilisé par un composant client.
2. Le layout n'était pas recalculé après le choix du genre (accent resté or) → `revalidatePath` du layout après les étapes identité et rôle.
3. Bouton « Suivant » / « Voir mon Casier » : React réutilisait le même bouton, le clic pouvait soumettre trop tôt → clés distinctes.
4. Un mot interdit dans l'anglais (« like », « match ») attrapé deux fois par le test de vocabulaire → reformulé.
5. « Le vrai · visible par toi seul » écrasait la ligne sur téléphone → étiquette sous la phrase.

### Décisions (porteur, 2026-10-05)
| Décision | Raison |
|---|---|
| `onboarding_step` 0–8 et `complete_onboarding` → 8 | 8 étapes pour les deux rôles (SPEC §4) ; « ≤ 7 » était l'état existant |
| `complete_onboarding` exige le Casier (Bad) et le QCM socle (les deux), sans cas particulier | 0 profil en base |
| Coordonnées masquées dans les chefs d'accusation (`mask_contacts`) | Même traitement que la présentation et le Motif |
| Alerte d'équilibre : chaque phrase comparée à la moyenne des deux autres, ±40 %, non bloquante | Remplace « une phrase dépasse les autres de 40 % » (LANDING-DESIGN §2.2, SPEC §6) |
| 60 amorces et anglais du QCM dans `docs/content/` | Relus par le conseiller de Chris avant la PR |
| Ton « Bad, pas toxique » : aucune violence, drogue, crime grave ni contenu sexuel | Amorces et traductions |

### Fait (vérifié)
- **3a — migration `20261005045519_phase3_qcm_casier`** (appliquée au dev, présente dans l'historique) :
  - types `importance`, `question_phase` ; `importance_weight()` ;
  - `questions` / `question_options` + seed des 20 questions (français mot pour mot depuis la SPEC, vérifié par script ; anglais de `docs/content/questions-en.md`) ;
  - `answers` : option de la même question (clé composée), acceptations dédoublonnées et validées, « toutes » = `null`, question inactive refusée ;
  - `casier_charges` : Bads seulement (politique **et** trigger, même pour le propriétaire de la base), masquage des coordonnées, mots-clés signalés (`flag_source = casier`, ligne n° 1/2/3), `casier_updated_at`, aucune suppression via l'API, lecture seule pour un ex-Bad ;
  - contrainte `onboarding_step` 0–8 ; `complete_onboarding()` v3 ;
  - RLS sur les 4 tables, droits remis à zéro (Supabase les accorde par défaut), types TypeScript régénérés.
- **3b — indice de complicité** :
  - `complicity_score(a, b)` et `common_points(a, b, n)` en SQL, **internes** (aucun droit pour `authenticated` / `anon`) ;
  - `lib/complicity.ts` ;
  - arrondi au demi supérieur calculé en entiers exacts des deux côtés (aucun écart possible dû aux flottants) ;
  - **23 cas partagés** (`tests/fixtures/complicity-cases.json`), attendus calculés par une 3e implémentation en fractions exactes : moins de 5 questions communes, compatibilité parfaite, incompatibilité totale, indispensable non satisfait (dans chaque sens, et sous 50 %), poids, demis exacts 12,5 et 87,5, 8 cas mélangés tirés au hasard (graine fixe).
- **pgTAP (base de dev)** :
  - `phase3_complicity_parity` : **46/46** (23 cas × 2 sens) ;
  - `phase3_security` : 14 groupes, **63/63** ;
  - `phase2_security` : 22 groupes, **104/104** (deux tests adaptés : terminer un onboarding demande maintenant le Casier et le QCM) ;
  - base revérifiée vide après les tests.
- **Vérifications** : typecheck, lint, **93 tests unitaires** (dont les 23 cas TS et le contrôle que le fichier pgTAP de parité est à jour), build.
- **Contenus à relire** : `docs/content/casier-amorces.md` (60 amorces FR + EN), `docs/content/questions-en.md`.

### Points à connaître
1. **Un seul projet Supabase** (`chvnmzmvcjvhxlnfmlvv`) sert le dev **et** la production Vercel. La production actuelle (code de la Phase 2c) ne peut plus terminer un onboarding avec la base de la Phase 3 ; elle le pourra une fois la PR de la Phase 3 fusionnée, et `SIGNUPS_OPEN=false` y ferme les inscriptions. Base de production séparée : checklist avant lancement.
2. **Le connecteur Supabase annule tout script contenant un `DELETE`**, même dans un test annulé ensuite. Les tests pgTAP de la Phase 3 vérifient donc les suppressions par les droits et les politiques (catalogue), sans exécuter de `DELETE`.
3. **Mots-clés de modération chargés** (migration `20261005152114_moderation_keywords`, 108 mots relus, sans « signal », `harassment` vide jusqu'à l'admin de la Phase 7) ; test pgTAP : un chef d'accusation qui contient un mot-clé est signalé.
5. **`SIGNUPS_OPEN` fermé par défaut** : seule la valeur exacte `true` ouvre les inscriptions (absente ou autre valeur = fermées), test unitaire ; Vercel vérifié : `false` en Production, `true` en Preview et Development.
4. Le fichier pgTAP de parité est **généré** depuis le fichier de cas (`UPDATE_PGTAP=1 pnpm vitest run tests/unit/complicity.test.ts`) ; le test unitaire échoue s'il n'est pas à jour.

## Checklist avant lancement (ouverture des inscriptions)
- [ ] **Base Supabase de production séparée** (décision du porteur, 2026-10-05 : pas pour l'instant, une base gratuite inactive se met en pause au bout de 7 jours). La créer juste avant l'ouverture : appliquer toutes les migrations, premier admin, Turnstile, SMTP, variables Vercel Production.
- [ ] `SIGNUPS_OPEN=true` sur Vercel Production (aujourd'hui `false` : « Inscriptions bientôt ouvertes » ; `true` en Preview et en local).
- [ ] Interdire aussi les inscriptions directes par l'API Auth tant que la production n'est pas prête : `SIGNUPS_OPEN` ne protège que le site (Supabase Auth → « Allow new users to sign up » sur la future base de production).
- [x] Relecture des contenus `docs/content/` et de la liste de départ des mots-clés (chargée).
- [ ] Remplir la catégorie `harassment` depuis l'admin (Phase 7).

### Pour plus tard (hors Phase 3)
- Anglais : remplacer « step up to the height chart » par « step into the lineup » avant l'ouverture internationale.


## Phase 2c — Habillage (2026-10-04, `docs/LANDING-DESIGN.md`)

### Fait (vérifié)
- **2c-0** clés i18n `judge*` → `consent*` (commit séparé).
- **2c-1 Logo transparent** : `logo-3d-t-360/560/840.avif` générés par `pnpm brand:build` depuis `logo-3d-transparent.png` (560 px : 46 Ko) ; l'image Open Graph garde `logo-3d.png` sur fond noir ; anciennes variantes opaques supprimées. L'en-tête garde le monogramme plat SVG.
- **2c-2 Landing centrée** (tout en CSS, aucun JS) : enseigne néon « Ouvert aux visites » (éclat bref toutes les 9 s, < 3 éclats/s), logo transparent, « trop. » en or lumineux, toise des deux côtés, porte **cellule** (barreaux, « Cellule B ») et porte **vitre de parloir** (reflets, hygiaphone, combiné), bandeau défilant, pièces à conviction (Bad), cartes néon (Visiteur), « 21:00 », les 5 phrases d'accord sous « Côté Bad / Côté Visiteur / Pour tous » (préfixes retirés), intro et « Les Bads d'abord » conservées, Charte, deux boutons finaux. Animations coupées avec `prefers-reduced-motion`.
- **2c-3 « Entraîne-toi »** : étape 4 du Visiteur (7 étapes), Casier fictif « n° 000 », tampons BIEN VU ! / RATÉ !, vrai signalé par icône + texte, rappel du secret, « Passer » ; rien n'est enregistré sauf le numéro d'étape. Les numéros d'étape sont désormais calculés depuis la liste du rôle ; changer de rôle renvoie aux étapes qui suivent.
- **Vert** : `#1D6B43` (papier, 5,06:1) et `#3CCF86` (sombre, 9,6:1), réservé à « BIEN VU ! » / « LE VRAI » (SPEC v7.3 §1 bis).
- **Vérifications** : typecheck, lint, 68 tests unitaires, build, **52 tests e2e** (dont onboarding Visiteur réel avec « Entraîne-toi » et axe sur l'étape), Lighthouse landing ×3 : 92–93 / 100 / 100 / 100, LCP simulé 3,2–3,3 s (tolérance 3,5 s ; 3,1–3,2 s avant), JS initial **117,6 Ko Brotli** (inchangé). Comptes de test supprimés.

### Défauts trouvés et corrigés
1. Bandeau défilant : texte noir sur `#E0233F` = 4,12:1 (axe) → fond `#EE3A55` (4,93:1).
2. Barre de progression de l'onboarding sans nom accessible (présent depuis la Phase 2, jamais testé par axe sur ces pages) → `aria-label`.
3. « like this one » dans le texte anglais de l'étape (attrapé par le test de vocabulaire) → « such as this one ».
4. « ? » orphelin en grand écran → espace insécable.

### Reste pour la Phase 3
- « Teste ton Casier » (Bad, étape 7, après la saisie du Casier) avec l'alerte d'écart de longueur > 40 %.

## Phase 2b — état (2026-10-03)

### Découpage annoncé
2b-1 migration + types + pgTAP · 2b-2 inscription et onboarding par rôle · 2b-3 Ton quartier, Ma Fiche / Mon Permis · 2b-4 landing, lexique, textes légaux, tampons · 2b-5 vérification.

### Fait (vérifié)
- **Base de dev** : 3 migrations (`concept_v2_types`, `concept_v2_roles_and_zones`, `concept_v2_recreate`) — rôle protégé (`role`, `role_changed_at`, aucun droit de colonne), `visit_motive` (masqué, mots-clés), colonnes `requests_*`, `set_onboarding_role()`, `complete_onboarding()` par rôle (étapes 0–7), un Visiteur ne peut avoir qu'une photo, `touch_activity()` (dernière activité, 1 écriture/h), `counts_for_zone()` et `zone_progress()` v2 (planchers absolus 50 / 20 / 10, Bads actifs < 30 j, Visiteurs en attente montrés aux Bads seulement), `btree_gist`, enums et préférences de notification v2.
- **pgTAP** : 22 groupes, **104 assertions, tout passe** (dont : rôle non modifiable, `set_onboarding_role` verrouillé après l'onboarding, Motif obligatoire et masqué, une seule photo pour un Visiteur, jauge du quartier avec pause / inactivité / photo non validée / Visiteurs exclus, nombre de Visiteurs caché aux Visiteurs).
- **Interface** : landing à deux portes (« Je suis Bad » / « Je viens visiter ») et déroulé par rôle ; inscription qui transmet la porte ; onboarding Bad en 5 étapes et Visiteur en 6 (« Ton rôle », « Qui tu cherches » / « Qui tu viens voir », Motif de visite) ; page `/quartier` (« Ton quartier ouvre bientôt », 3 jauges) ; Ma Fiche / **Mon Permis de visite** (carte Permis, une seule photo remplaçable, Motif modifiable, statut « au Greffe ») ; tampons BONNE CONDUITE, CASIER VIERGE, PERMIS DÉLIVRÉ, VISITE ACCEPTÉE ; lexique v7 fr/en ; Charte, CGU et confidentialité réécrites (paragraphe Web Push) ; versions des consentements montées (`cgu-2026-10-draft-2`, `privacy-2026-10-draft-2`, `art9-seeking-v2`).
- **Vérifications** : typecheck, lint, **67 tests unitaires** (dont étapes par rôle, validation rôle/Motif, vocabulaire retiré interdit), build, **52 tests e2e** dont les deux onboardings réels (Bad et Visiteur, ≈ 9 s chacun en automatique, comptes jetables supprimés), axe 0 violation ; Lighthouse landing : Performance 93, Accessibilité 100, Bonnes pratiques 100, SEO 100 ; JS initial de la landing **≈ 118 Ko Brotli** (budget 130 ; hors polyfill `nomodule` de 34 Ko que les navigateurs récents ne chargent pas).
- Base de dev revérifiée vide : 0 profil, 0 compte, 0 fichier en attente.

### Écarts / points à connaître
1. **Migration `concept_v2_recreate` appliquée à la main par le porteur** (SQL Editor) : le connecteur Supabase annulait systématiquement les requêtes destructives (confirmation jamais reçue). Elle n'apparaît donc **pas** dans l'historique `supabase_migrations` du projet de dev (l'insertion de la ligne d'historique a elle aussi été bloquée). Le fichier est dans le dépôt (`supabase/migrations/20261003223804_concept_v2_recreate.sql`). À faire une fois : `supabase migration repair --status applied 20261003223804` depuis un poste avec la CLI connectée, ou l'ignorer tant que le dev reste piloté par le connecteur.
2. **Casier et 10 questions** : non demandés en 2b ; un Bad termine à la photo (étape 5), un Visiteur au Motif (étape 6). La Phase 3 ajoute le Casier (Bad, étape 6) et le QCM (étape 7, les deux rôles) et les contrôles correspondants dans `complete_onboarding()` et `counts_for_zone()`.
3. **`casier_charges` n'existe pas encore** : elle sera créée directement avec `true_index` en Phase 3 (pas de renommage nécessaire, contrairement à SCHEMA §6 v2 initial).
4. **`touch_activity()` livrée dès 2b** (prévue en Phase 4) : sans elle, aucun Bad ne compterait pour l'ouverture d'un quartier.
5. **Badges du Permis** : « Casier vierge » toujours vrai et « Nouveau visiteur » tant que signalements (Phase 7) et visites (Phase 5) n'existent pas.
6. Tests pgTAP : pseudos de test sans chiffres et zones de test fictives, pour ne plus dépendre du hasard ni des zones de dev Toulon/Nice (2 tests étaient fragiles depuis la Phase 2).
7. Mesures Lighthouse : lancer le serveur sur le port de `NEXT_PUBLIC_SITE_URL` (3000 en local), sinon l'audit « canonical » échoue (SEO 92) sans rapport avec le code.

### Corrections de vocabulaire du porteur (2026-10-04, `docs/LANDING-COPY.md`)
- Texte de la landing appliqué mot pour mot (fr), traduit en anglais.
- « Libération » retiré : après une visite réussie, **le Permis devient permanent** (tampon « PERMIS PERMANENT ») ; « aveux » → « chefs d'accusation ».
- Correction n° 2 : « Le Juge, c'est toi » → **« Le Courrier »** ; principe → **« Ici, rien ne se fait sans ton accord. »** ; icône marteau (`Gavel`) remplacée par une clé (`KeyRound`) ; `get_judge_inbox` prévu en Phase 4 renommé `get_mailbox`.
- Le test de vocabulaire (textes affichés seulement, pas les noms de clés) refuse : match/swipe/like, Plaidoirie, Réglo, Audience, Libération, aveux, « deviner le/lequel », juge (fr) ; plead, legit, hearing, release, confession, judge (en).

### Comment tester
1. `pnpm build && pnpm start`, ouvrir `/` : deux portes.
2. « Je viens visiter » → `/inscription?role=visitor` (« Prendre mon Permis de visite »), créer un compte, confirmer l'e-mail.
3. Onboarding : étape 3 présélectionnée, « Qui tu viens voir », photo puis Motif de visite → `/quartier`, puis `/ma-fiche` (Mon Permis).
4. Recommencer avec « Je suis Bad » : 5 étapes, `/quartier` affiche les Visiteurs en attente.


## Concept v2 — intégration (2026-10-03)

Source : `docs/CONCEPT-V2.md` (décision du porteur). Documents mis à jour : `docs/SPEC.md` (v7), `docs/SCHEMA.md` (v2, marqueurs [v2-modif] / [v2-nouveau] / [v2-supprimé], plan de migration §6), `docs/PROMPT.md` (plan v7 : Phases 2b à 9), `CLAUDE.md` (lexique §8).

### Règles précisées — ✅ validées par le porteur (`CONCEPT-V2-DECISIONS.md` §A)
1. **Choix du rôle** : la porte de la landing présélectionne le rôle ; l'étape « Ton rôle » le confirme (le concept dit à la fois « fixé avant la création du compte » et « étape après l'identité »).
2. **Motif de visite** dans une colonne séparée (`visit_motive`, 280 caractères, obligatoire pour un Visiteur) : la présentation d'un Bad (500) n'est pas perdue quand il change de rôle.
3. **Visiteur = 1 photo affichée** ; les autres photos d'un ex-Bad sont gardées en réserve.
4. **Seuil d'ouverture** : planchers absolus (50 Bads, ≥ 20 bad girls, ≥ 10 bad boys), Bads comptés = visibles, pas en pause, connectés < 30 jours ; un quartier ouvert ne se referme pas tout seul.
5. **Raccourcis** : « Ce soir » 21 h, « Demain soir » 21 h, « Ce week-end » samedi 18 h.
6. **Annulation < 2 h avant** = absence de celui qui annule.
7. **Délai de 48 h** pour que le Bad repropose des créneaux (après « Aucun ne me va » ou un report), sinon classement.
8. **Présence** = ouverture de l'écran de visite (horodatage de la base).
9. **Casier vierge** = aucun signalement retenu ni sanction depuis 12 mois.
10. **Bonne conduite** = compte > 30 jours, ≥ 3 visites honorées, aucun signalement retenu, aucune absence ni annulation tardive depuis 30 jours.
11. **Notifications push au contenu neutre** (ni pseudo, ni photo, ni texte de message).
12. **Greffe minimum en Phase 3** (validation des photos) au lieu de la Phase 6 : sans photo validée, rien n'est testable de bout en bout.
13. **Fin de visite sans Permis permanent** : le choix de chacun reste secret (l'autre voit seulement « Affaire classée »).
14. **(ajoutée par le porteur) Pari secret pour les deux jusqu'à la visite** : le Bad décide sans voir ni le chef choisi ni le résultat ; les deux sont révélés ensemble comme premier message du Parloir ; le Souffleur ne cite jamais le chef choisi ; avertissement « Ton pari reste secret jusqu'à la visite. » ; la métrique d'acceptation selon pari juste/faux doit être neutre, sinon c'est une fuite.

### Autres décisions du porteur (§B à §D)
- Seuil : 50 Bads, ≥ 20 bad girls, ≥ 10 bad boys (réglable, 0 = désactivé) ; seuls les Bads connectés depuis moins de 30 jours comptent.
- Greffe minimal (photos et Permis) avancé en Phase 3.
- Plan des phases validé ; **la Phase 5 s'arrête après chaque sous-phase** (5a, 5b, 5c) avec validation et test sur téléphone.

### Risques relevés (acceptés, suivis — §E)
- ~~Le Bad déduit le résultat du pari~~ : **résolu par la règle 14**. Risque résiduel : un Visiteur peut citer lui-même le chef dans son mot libre ; l'avertissement de la modale le dissuade, rien ne l'empêche.
- **Capacité de la Promenade** : 50 Bads × 10 sorties = 500 places par soir → 100 Visiteurs servis à 5 Bads au seuil d'ouverture. Au-delà, des Visiteurs en reçoivent moins.
- **Realtime gratuit** : le plafond de connexions simultanées (à vérifier, de l'ordre de 200) correspond à environ 100 visites simultanées, concentrées à 21 h. Repli par interrogation prévu.
- **iPhone** : Web Push seulement si le site est installé sur l'écran d'accueil (iOS 16.4+, à vérifier). Une partie des rappels n'arrivera pas.
- **Web Push** transite par les services des navigateurs (Google, Mozilla, Apple), contenu chiffré : à mentionner dans la politique de confidentialité.
- **Tâche chaque minute** (`pg_cron`) : charge faible, à surveiller sur l'offre gratuite.

## Phase 2 — Comptes, onboarding, Fiche, photos, zones : ✅ validée et fusionnée (PR #5)

### État (2026-10-02)

### Découpage annoncé
2a extensions · 2b schéma + RLS · 2c tests pgTAP · 2d stockage photos · 2e authentification · 2f onboarding · 2g photos · 2h Ma Fiche, ville, parrainage · 2i premier admin + seed.

### Fait (vérifié)
- **Base de dev** (`chvnmzmvcjvhxlnfmlvv`, Postgres 17, région `eu-west-1`) : 5 migrations appliquées via le connecteur Supabase ; les fichiers de `supabase/migrations/` sont identiques octet pour octet au SQL enregistré (MD5 comparés).
- **`pg_cron` et `pg_net` activés** sur l'offre gratuite : question de Phase 0 tranchée.
- **Tests pgTAP** (`supabase/tests/phase2_security.test.sql`) : 21 groupes, 82 assertions, **tout passe** (RLS partout, `anon` sans aucun droit, colonnes protégées, 18+ même via l'API et même pour le propriétaire de la base, date de naissance verrouillée, pseudo sans coordonnées, masquage bio/précisions, photos, consentements en ajout seul, admin non auto-attribuable, hook des bannis, recalcul des zones B1, onboarding, parrainage, jauge, stockage). Ils ont trouvé un vrai bug (`complete_onboarding`), corrigé par migration.
- **Advisors Supabase** : sécurité, seuls des signalements attendus (tables volontairement fermées, fonctions RPC prévues) ; performance, index de clés étrangères ajoutés.
- **Communes** : script officiel `scripts/import-places.mjs` (geo.api.gouv.fr) ; Var + Alpes-Maritimes importés en dev (316 communes) ; zones de dev Toulon et Nice (35 km, « bientôt »).
- **Authentification** : inscription, connexion mot de passe ou lien magique, mot de passe oublié/nouveau, déconnexion, route `/api/auth/confirm` (liens `token_hash` et `?code=`), Turnstile (widget prêt, inactif sans clé), messages d'erreur sans énumération de comptes, garde des pages connectées.
- **Onboarding étapes 1 à 4** avec reprise, recherche de ville accessible, consentement art. 9 séparé et non pré-coché ; **photos** compressées dans le navigateur puis ré-encodées par le serveur (`sharp`) en WebP 1200/400 px **sans aucune métadonnée** (test unitaire avec GPS réel) ; bucket privé `photos-pending`, notification admin mise en file.
- **Ma Fiche** (aperçu, statut de modération, jauge, bio, signes distinctifs, photos), **Ta ville ouvre bientôt** (jauges, lien de parrainage, compteur), scripts **premier admin** et **seed de dev** (garde-fous testés).
- Vérifications : typecheck, lint, 61 tests unitaires, build, 40 tests e2e Phase 1 + 3 tests e2e réels (connexion, refus d'un mineur) contre Supabase.

### Bugs trouvés et corrigés pendant la phase
1. `complete_onboarding()` plantait (`text[] || 'littéral'`) → migration de correctif.
2. Réinitialisation automatique des formulaires React 19 : l'e-mail et les saisies étaient effacés après une erreur → soumission sans réinitialisation (`lib/forms/submit.ts`).
3. `upsert` PostgREST réécrit la colonne `id` (non autorisée aux membres) → insert ou update.
4. Seed : faux garde-fou « production » et tableau 2D invalide → corrigés.

### Finalisation (2026-10-03, après les réglages du porteur)
- **Test B5 — hook « Before User Created »** sur le projet réel : une adresse bannie est **refusée** pour le lien magique (403 `email_banned`), pour l'inscription par mot de passe, et en majuscules. Aucun e-mail n'est envoyé. ⚠️ La création de compte par l'API d'administration (clé secrète) **n'est pas** soumise au hook : réservée au serveur, à ne jamais exposer.
- **Communes de France** : 34 969 importées (`scripts/import-places.mjs --push`, 18 s, 15 Mo). Recherche sans accent et par code postal vérifiée.
- **Onboarding complet** (test e2e `onboarding-complete.spec.ts`, compte jetable créé et supprimé par le test) : connexion → étapes 1 à 4 → page de la ville, **7,7 à 8,5 s** en automatique ; 4 consentements enregistrés ; photo stockée en WebP **sans EXIF** (fichier téléchargé et vérifié) ; Ma Fiche (bio masquée, signe distinctif, jauge 40 %) et Ta ville (zone, lien de parrainage) contrôlées avec axe : 0 violation.
- **Chrono humain** : 13 saisies réparties sur 4 écrans ; estimation 2 à 4 minutes selon le choix de la photo. **C'est une estimation**, à confirmer en le faisant toi-même sur ton téléphone.
- Nettoyage : compte de test et 5 Fiches fictives supprimés ; base de dev vide de membres (communes, tribus, 2 zones de dev conservées).
- Bug trouvé : des comptes insérés en SQL avec des jetons `NULL` cassent la liste des utilisateurs de Supabase Auth → seed corrigé.

### Reste pour plus tard (hors Phase 2)
- Validation admin des photos et copie vers le bucket public : Phase 6 (`/admin`).
- Envoi réel des e-mails de la file (`email_outbox`) : Phase 6 (Brevo).

### Écarts par rapport à la spec / au schéma
1. **Onboarding en 4 étapes en Phase 2** : le Casier (étape 5) et les 10 questions (étape 6) sont construits en Phase 3, qui étendra `complete_onboarding`.
2. **Photos ré-encodées côté serveur** (en plus de la compression navigateur) : Safari ne sait pas toujours encoder en WebP ; cela garantit aussi l'absence d'EXIF même si un membre contourne l'interface.
3. **Parrainage** porté par l'inscription (`?parrain=` → métadonnée du compte), pas par un cookie : aucun traceur supplémentaire.
4. **Fichiers photo** : `{user}/{uuid}.webp` (1200 px) et `{user}/{uuid}-s.webp` (400 px) ; seule la grande taille est enregistrée dans `photos.pending_path`.
5. Région Supabase `eu-west-1` (Irlande) et non Paris : reste dans l'UE.

### Actions encore attendues du porteur
1. **SMTP Brevo** et **Turnstile** dans Supabase Auth, quand tes comptes sont prêts (le widget s'active dès que `NEXT_PUBLIC_TURNSTILE_SITE_KEY` est défini).
2. **Vercel** : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (production et prévisualisation), `APP_ENV=production` (production).
3. Ne pas fusionner les branches `vercel/install-vercel-*` (outils de mesure tiers, exclus par la spec).

## Phase 0 — Cadrage : ✅ validée (2026-10-01)

- Livrables : `docs/PHASE0.md` (vérifications, risques R1–R32, arborescence, env, jobs, comptes à créer), `docs/SCHEMA.md` (schéma v1 validé), `docs/PHASE0-DECISIONS.md` (réponses du porteur + corrections B1–B7).
- Décisions intégrées dans `docs/SPEC.md` (v6.1), `docs/SCHEMA.md` et `CLAUDE.md` (tableau du vocabulaire corrigé, R27).

## Phase 1 — Fondations et identité : ✅ validée (2026-10-02)

Tous les écarts ci-dessous sont **validés** (`docs/PHASE1-DECISIONS.md` §A) : budget JS mesuré en Brotli ; LCP jugé sur les visiteurs réels (75e centile < 2,5 s), tolérance laboratoire ≤ 3,5 s ; rouge et nuances dérivées ; logo AVIF en `<img>` ; `style-src 'unsafe-inline'` ; rendu dynamique (test d'une landing statique avec CSP par empreintes en Phase 7 seulement si le LCP réel l'exige) ; ESLint 9 ; pas de détection automatique de langue.

### Bilan

### Fait
- **1a Socle** : Next.js 16.3.8 (App Router, `proxy.ts`), TypeScript strict (+ `noUncheckedIndexedAccess`), Tailwind 4, ESLint 9 flat config (règles : pas de `any`, pas de `dangerouslySetInnerHTML`, pas de `next/link` direct, clé secrète Supabase interdite hors `lib/supabase/admin.ts`), Prettier, next-intl 4 (fr par défaut sans préfixe, en sous `/en`, **sans détection automatique de langue**), Vitest, Playwright + axe-core, Supabase CLI (`supabase/config.toml`), `.env.example`.
- **1b Design system** : tokens dans `app/globals.css` ; polices auto-hébergées via `next/font` (Anton, Inter Tight, Special Elite, Yellowtail — les deux dernières non préchargées) ; composants `components/ui` (Button, ButtonLink, Input, Select, Checkbox, Field, Modal `<dialog>` natif, Toast avec `aria-live`, Badge, Skeleton, EmptyState) et `components/brand` (Logo, Stamp animé avec repli `reduced-motion`, Toise, FicheCard). Vitrine : `/design` (masquée quand `APP_ENV=production`).
- **1c Marque** : monogramme SVG plat `public/brand/logo.svg` (provisoire, décision 15), `app/icon.svg`, `app/apple-icon.png`, icônes PWA 192/512 + maskable, `manifest.webmanifest`, image Open Graph `public/brand/og.jpg` ; tout est généré par `pnpm brand:build`.
- **1d Pages** : landing ; connexion (mot de passe ou lien magique), inscription, mot de passe oublié (UI + validation client seulement, emplacement Turnstile) ; CGU, confidentialité, mentions légales (modèles `[À COMPLÉTER]` / `[À FAIRE VALIDER PAR UN JURISTE]`) ; Charte ; Conseils sécurité ; 404 et 500 à l'image de la marque.
- **1e Sécurité/indexation** : CSP avec nonce par requête + `strict-dynamic` (scripts sans `unsafe-inline`), `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS, COOP ; `X-Robots-Tag: noindex, nofollow` + meta robots sur tout sauf landing, pages légales et Charte ; `robots.txt` et `sitemap.xml` limités à ces pages.
- **1f Vérification** : voir « Critères » ci-dessous.

### Critères de la Phase 1
| Critère | Résultat |
|---|---|
| typecheck / lint / test / build | ✅ 0 erreur ; 24 tests unitaires ; 40 tests e2e |
| Lighthouse mobile ≥ 90 sur la landing | ✅ Performance 93–97, Accessibilité 100, Bonnes pratiques 100, SEO 100 (5 mesures) |
| Aucune chaîne en dur | ✅ test automatique (`tests/unit/i18n.test.ts`) qui analyse le JSX ; parité des clés fr/en testée ; vocabulaire interdit (match, swipe, like) testé |
| Rendu 360 → 1440 px | ✅ aucun défilement horizontal à 360, 414, 768, 1024, 1280, 1440 px (test e2e) |
| Navigation clavier | ✅ lien d'évitement, focus visible, modale (piège de focus, Échap, retour du focus), focus sur le premier champ en erreur (tests e2e) ; axe-core WCAG 2.2 AA : 0 violation sur les 11 pages |
| JS initial landing < 130 Ko compressé en Brotli (SPEC §18) | ✅ **117 Ko** (137 Ko en gzip, pour information). Le socle du framework (React + routeur Next) pèse à lui seul ~126 Ko gzip |
| LCP (SPEC §18) | ✅ tolérance laboratoire ≤ 3,5 s respectée ; LCP réel mesuré en Phase 7 —  landing : 2,4 à 3,2 s en simulation Lighthouse mobile (4G lente simulée) ; sans simulation, l'image LCP s'affiche en ~0,2 s. Voir écart n° 3 |

### Écarts par rapport à la spec
1. **Couleurs dérivées pour l'accessibilité** : le rouge `#E0233F` n'atteint pas 4,5:1 (4,12 sur noir, 3,86 sur crème). Il reste utilisé pour les grands titres, bordures et décors ; ajout de `#EE3A55` (texte rouge sur noir, 4,93:1), `#B5172E` (rouge sur crème, 5,53:1), `#7A6420` (or sur crème), `#6A5F55` (gris sur crème). Les boutons principaux sont or sur noir (8,42:1).
2. **Budget JS** : tenu en Brotli, pas en gzip (voir tableau). Pour y arriver : pas de `tailwind-merge`, liens localisés rendus côté serveur (`LocalizedLink`) au lieu du `Link` client de next-intl, runtime i18n client chargé uniquement sur les pages d'authentification et `/design`, page 500 sans next-intl (textes lus dans un `<template>` rendu par le serveur), `zod/mini` pour la validation partagée. **À valider : la mesure de référence est-elle Brotli (ce que reçoit l'utilisateur) ?**
3. **LCP simulé** : le modèle Lighthouse compte le JS du framework dans le chemin du LCP. Pistes si tu veux le seuil en laboratoire : supprimer l'hydratation de la landing (pas possible proprement en App Router), ou mesurer le LCP réel des visiteurs (Web Vitals envoyés à notre propre route, sans outil tiers) en Phase 7.
4. **Logo de la landing en `<img>` AVIF** au lieu de `next/image` (§11) : l'image est pré-optimisée et `next/image` ajoutait un composant client. `next/image` reste utilisé pour les photos des Fiches.
5. **`style-src 'unsafe-inline'`** dans la CSP : React rend des attributs `style` côté serveur. Les scripts, eux, n'ont ni `unsafe-inline` ni `unsafe-eval` en production.
6. **Toutes les pages sont rendues dynamiquement** (nonce CSP par requête). Coût : une invocation de fonction Vercel par visite (quota Hobby : 1 M/mois).
7. **ESLint 9** (marqué « non supporté » par ses mainteneurs) : `eslint-plugin-react`, dépendance de `eslint-config-next`, n'accepte pas encore ESLint 10. À remonter dès que possible.
8. **Pages d'authentification** : interface seulement ; le bouton affiche « Les inscriptions ne sont pas encore ouvertes ». Branchement Supabase + Turnstile en Phase 2.

## Phase 1 — découpage annoncé

1. **1a — Socle** : Next.js 16 + TypeScript strict + Tailwind 4 + ESLint (flat config) + Prettier + next-intl (fr/en) + Vitest + Playwright + Supabase CLI ; scripts `typecheck`, `lint`, `test`, `build`.
2. **1b — Design system** : tokens (couleurs, typo, espacements), polices auto-hébergées, composants de base (Button, Input, Select, Checkbox, Modal, Toast, Badge, Tampon animé + `reduced-motion`, Carte Fiche, fond Toise, Squelettes, États vides).
3. **1c — Marque** : logo SVG plat (monogramme), favicon, icônes PWA, manifest, image Open Graph depuis `logo-3d.png`.
4. **1d — Pages** : landing, connexion/inscription (UI seule), pages légales (modèles), Charte, Conseils sécurité, 404/500.
5. **1e — Sécurité et indexation** : en-têtes (CSP, etc.), `robots.txt`, `noindex` sur l'application.
6. **1f — Vérification** : typecheck/lint/test/build, Lighthouse mobile de la landing, rendu 360–1440 px, navigation clavier, contrôle « aucune chaîne en dur ».

## Décisions (validées)

| Décision | Raison |
|---|---|
| Tâches planifiées via `pg_cron` (+ `pg_net` → routes `/api/cron/*`) | Cron Vercel Hobby : 1×/jour, ±59 min |
| Cron Vercel quotidien `/api/health` | Éviter la pause Supabase Free après 7 jours d'inactivité |
| SMTP Brevo | 300 e-mails/jour (Resend : 100), société UE |
| Clés Supabase `sb_publishable_` / `sb_secret_` | `anon` / `service_role` dépréciées fin 2026 |
| `proxy.ts` au lieu de `middleware.ts` | Convention Next.js 16 |
| Turnstile via l'intégration native Supabase Auth | Vérification côté Supabase |
| Les tiers ne lisent jamais les tables, uniquement des fonctions `security definer` | Pas de fuite de date de naissance, du faux du Casier, des réponses QCM |
| Empreinte des bannis : HMAC-SHA256 + poivre, sans normalisation des alias | Décision 11 |
| Bannis vérifiés par le hook Auth « Before User Created » (fonction Postgres), aucun trigger sur `auth.users` | B4 ; hook disponible sur Free (doc Auth Hooks, vérifié le 2026-10-01) |
| Photos : 180 Ko / 30 Ko, bucket public à chemins UUID avec rotation | Décisions 1–2 |
| Plafond d'apparitions dans l'Audience : 10/jour | Décision 12 |
| Compte supprimé : texte des messages effacé en base | Décision 5 (option stricte) |
| Table du Casier nommée `casier_charges` | Alignement sur le vocabulaire de CLAUDE.md (j'avais écrit `casiers` en Phase 0) |
| TypeScript 6.0.x (et non 7.x) | `typescript-eslint` 8.71 exige TS < 6.1 ; TS 7 (portage natif) pas encore pris en charge par l'outillage ESLint |
| ESLint 9.39.x (et non 10.x) | `eslint-plugin-react` (dépendance de `eslint-config-next`) n'accepte pas ESLint 10 |

## Points relevés en Phase 0 → tranchés en Phase 1 (`PHASE1-DECISIONS.md` §B)

1. **Egress** : pas d'API de gestion. Stockage calculé en SQL ; egress saisi chaque mois par l'admin (table `egress_readings`), alerte sur la valeur saisie.
2. **Audience à moins de 5 Fiches** : accepté ; le tableau de santé affiche la part des membres concernés.
3. **Levée du masquage** : bloquée par un signalement ouvert entre les deux personnes, ou contre l'une d'elles dans les catégories `scam`, `minor`, `harassment`, `violence_threat` uniquement.
4. **Comptes sans onboarding** : un seul e-mail à J+7 (`onboarding_reminder`, priorité la plus basse), suppression à J+30.
5. **Hook « Before User Created » et lien magique** : à tester en Phase 2 ; s'il ne s'exécute pas pour le lien magique → arrêt et proposition avant de continuer.

## Organisation

- Fin de chaque phase validée → pull request vers `main`. `main` est déployée en production par Vercel, chaque branche en prévisualisation.
- Phase 7 : collecte des Core Web Vitals réels (`web-vitals` + route interne, table `web_vitals_daily`, agrégats sans identifiant ni IP, 90 jours).

## Versions figées

| Outil | Version |
|---|---|
| Node.js (environnement de travail) | 22.22.0 |
| pnpm | 10.28.0 |

Toutes les dépendances sont figées à la version exacte dans `package.json` (pas de `^`) :

| Paquet | Version |
|---|---|
| next / eslint-config-next | 16.3.8 |
| react / react-dom / @types/react(-dom) | 19.3.0 |
| next-intl | 4.14.8 |
| @supabase/supabase-js | 2.117.2 |
| @supabase/ssr | 0.12.7 |
| zod | 4.6.5 (client : `zod/mini`) |
| lucide-react | 1.49.0 |
| clsx | 2.1.1 |
| tailwindcss / @tailwindcss/postcss | 4.3.3 |
| typescript | 6.0.3 |
| typescript-eslint | 8.71.0 |
| eslint / @eslint/js | 9.39.5 |
| prettier | 3.9.9 (+ prettier-plugin-tailwindcss 0.8.1) |
| vitest | 5.0.3 |
| @playwright/test | 1.63.0 (+ @axe-core/playwright 4.13.0) |
| lighthouse | 13.5.0 (+ chrome-launcher 1.2.2) |
| supabase (CLI) | 2.119.0 |
| sharp | 0.35.5 |

## Contraintes d'environnement constatées

- Docker est installé mais le démon ne tourne pas dans l'environnement cloud de Claude Code → pas de Supabase local ici. Les tests pgTAP tourneront contre le projet Supabase de dev (ou en local chez le porteur avec Docker).
- Chromium préinstallé (`/opt/pw-browsers/chromium`), utilisé par Playwright et Lighthouse via `executablePath`.

## Questions ouvertes

- Nom de domaine : `[DOMAINE]` en attendant.
- Numéros d'urgence de la page Conseils sécurité (17, 112, 3919) à faire vérifier avant publication.

## Commandes utiles

| Commande | Rôle |
|---|---|
| `pnpm install` | dépendances |
| `pnpm dev` | serveur de dev sur http://localhost:3000 |
| `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm build` | définition de « terminé » |
| `pnpm test:e2e` | Playwright (360 et 1440 px) contre `pnpm start` sur le port 3100 ; nécessite un `pnpm build` préalable |
| `pnpm start --port 3100` puis `pnpm lighthouse http://localhost:3100 / /charte` | audit Lighthouse mobile (rapports HTML dans `lighthouse-reports/`) |
| `pnpm brand:build` | régénère icônes, image OG et logo AVIF depuis `public/brand/logo.svg` et `logo-3d.png` |
| `pnpm format` | Prettier |

Chromium : Playwright et Lighthouse utilisent `/opt/pw-browsers/chromium` par défaut ; sur une autre machine, définir `PLAYWRIGHT_CHROMIUM_PATH` et `CHROME_PATH`.
