# PROGRESS — Bad Boys & Bad Girls

> À lire en premier à chaque session. Mis à jour à chaque étape significative.

## Phase en cours

**Phase 5 terminée et en production** (2026-10-19) : fusionnée dans `main` (PR #12, `b00a8f7`) et déployée par le conseiller après vérification de la prod (36 migrations identiques aux fichiers, fonctions identiques à la preview, 0 table sans RLS, coffre vide hors poivre). Super admin de prod accordé au compte du porteur. **Phase 6 (Parloir sans horaire et Cavale) : validée par le conseiller** (2026-10-20 : cause réelle corrigée, CI n° 27 verte deux fois), décisions 6-1 à 6-14 validées ; en attente de la fusion (rien sur `main` ni sur la prod). **Phase 7 en cours** : sous-phase 7a (modération).

## Bases Supabase : preview et production (2026-10-17)

- **Historique de la preview complété (2026-10-19)** : la ligne `20261003223804 concept_v2_recreate` manquait ; ajoutée avec le SQL du fichier dans `statements` (MD5 identique), **rien réappliqué**. Historique de la preview = les 36 fichiers de `main` (empreinte identique, comme la prod).

- **Preview** : `bad-boys-preview` (`chvnmzmvcjvhxlnfmlvv`, eu-west-1) — l'ancienne base « dev », branches et previews Vercel ; c'est là que vont les migrations des phases en cours.
- **Production** : `bad-boys-prod` (`hmmobtyherwuhrhymfbk`, eu-west-3, Postgres 17). Réglée par le porteur : inscriptions coupées, URL du site, TOTP ; `SUPABASE_SECRET_KEY` posée en Production sur Vercel.
- **Mise en place (2026-10-17, par Claude via le connecteur)** : uniquement les **25 migrations de `main`** (`20261002192027_extensions` → `20261006112943_phase4_promenade_tiers`), contenu exact des fichiers.
  - 23 passées par le connecteur : le SQL enregistré par Supabase est identique octet pour octet aux fichiers (MD5 comparés ; seul le dernier saut de ligne diffère).
  - 2 avec `DROP` (`20261003223804_concept_v2_recreate`, `20261005045519_phase3_qcm_casier`) : le connecteur les annule avant toute demande de confirmation → exécutées par le porteur dans le SQL Editor. L'éditeur a ré-indenté le corps de 5 fonctions (`zone_progress`, `importance_weight`, `answers_before_write`, `casier_charges_after_write`, `common_points`) : même logique, texte différent → redéfinies par Claude avec le texte exact des fichiers (`create or replace`, droits inchangés).
  - Ordre : `moderation_keywords` (n° 10) appliquée par erreur avant `phase3_poses_greffe` (n° 9) ; sans effet (aucune dépendance entre les deux, état final identique, vérifié).
  - Historique `supabase_migrations.schema_migrations` remis aux versions et noms exacts des fichiers (25 lignes) ; les deux migrations du SQL Editor y sont sans texte enregistré (`statements` vide).
  - Communes 83/06 chargées (`supabase/fixtures/places-83-06.sql`, 316 communes). Aucun quartier (la migration Toulon / Nice n'est pas sur `main`).
- **Vérifié** contre une base de référence locale construite avec ces 25 migrations et les communes (empreinte MD5) : fonctions (79, texte et droits), colonnes, contraintes, index, politiques RLS (public et storage), déclencheurs, types, droits des tables, tâches pg_cron (2), buckets (2), extensions, données (questions, options, signes, mots-clés, communes) : **identiques**. Écarts attendus seulement : dates de création (`app_settings.updated_at`, `questions.created_at`) et droits par défaut de schémas propres à la plateforme (`supabase_functions` en local).
- **Sécurité** : 24 tables, **0 sans RLS**, aucun droit de table ni de fonction pour `anon`. Audit Supabase : rien de plus qu'en preview (10 tables sans politique et 26 fonctions membres, toutes aussi en preview ; « Leaked password protection » désactivée, comme en preview).
- **À savoir** : la migration `core_schema` crée elle-même dans le coffre de la prod le poivre `ban_email_pepper` (généré dans la base, jamais affiché) : 1 secret dans le coffre, rien d'autre n'y a été touché. `auth.users` contient 1 compte (créé hors de cette mise en place), aucun profil.
- **Migrations de `phase-5` (2026-10-18, avant la fusion dans `main`, par Claude via le connecteur)** : 10 des 11 migrations absentes de `main`, dans l'ordre, contenu exact (MD5 du SQL enregistré = MD5 des fichiers, les 10) : `phase5a_web_push`, `phase5a_push_vault_reads`, `phase5a_push_secret_names`, `launch_zones_toulon_nice`, `phase5a_ter_super_admin`, `phase5b_visiting_hours`, `phase5b_complements`, `phase5c_parloir`, `phase5c_absence_close`, `phase5_promenade_open_mode`. Historique remis aux versions et noms exacts.
  - `20261006190000_phase5a_drop_push_route_config` (un `DROP`) : lancée par le porteur dans le SQL Editor le 2026-10-19 ; `push_route_config()` absente (vérifié) ; ligne d'historique ajoutée par Claude avec le texte exact du fichier (MD5 identique). **Historique de la prod = les 36 fichiers de `phase-5`** (versions et noms, empreinte identique).
  - **Vérifié** contre la base locale construite avec les 36 migrations de `phase-5` (empreinte MD5 par catégorie, `push_route_config` exclue) : fonctions (122), colonnes (290), politiques (25), déclencheurs (34), types énumérés (23), droits des tables (230) et des fonctions (181), RLS (31 tables), tâches pg_cron (5), publication Realtime : **identiques**. **0 table sans RLS.** Audit Supabase identique à la preview (16 tables sans politique, 46 fonctions membres, « Leaked password protection » désactivée).
  - Prod : `launch_mode = 'zones'`, Toulon et Nice en liste d'attente, 0 super admin, **coffre inchangé** (1 secret : `ban_email_pepper`), aucune variable Vercel touchée. Sans `push_endpoint_url` ni `push_cron_secret`, `push_dispatch` ne fait rien (vérifié dans le code).
- **Reste** : super admin ; clés de notification propres à la prod au lancement (checklist) ; retrait des droits d'écriture du connecteur d'IA sur la prod (checklist).

## Phase 7 — Modération, pilotage, tâches planifiées, RGPD, e-mails (2026-10-19, découpage annoncé, sous-phases enchaînées)
Relu : PROMPT Phase 7, SPEC §10 (RGPD, DSA, sécurité), §14, §15, §16, SCHEMA §3.4-§3.5, tables déjà en base (`reports`, `moderation_actions` en ajout seul, `flagged_texts`, `consents`, `banned_email_hashes` + crochet « Before User Created », `email_outbox`, `notification_preferences`).
Découpage (CI verte avant chaque sous-phase suivante ; arrêt et rapport à la fin de la phase) :
- **7a — Modération** : `/admin/signalements` (file, décision motivée : retenu ou rejeté, sanction avertissement / suspension / bannissement / masquage / retrait de Bonne conduite, motif obligatoire), `/admin/textes` (textes signalés), recherche d'un membre et historique des décisions ; exposé des motifs au signaleur et à la personne sanctionnée ; bannissement = empreinte de l'e-mail + compte Auth banni. pgTAP (aal2, ajout seul, super admin intouchable).
**7a — fait (local)** : migrations `20261019130000_phase7a_moderation_types` et `20261019130100_phase7a_moderation` ; pgTAP `phase7a_moderation.test.sql` (8 groupes : admins seulement et aal2, signalement retenu avec suspension, règles des motifs, bannissement et levée, protections, « mineur », textes signalés, recherche) ; 13 fichiers, 116 tests verts. Écrans `/admin/signalements`, `/admin/textes`, `/admin/membres` (+ fiche du membre et formulaire de sanction), `/admin/historique`, navigation admin ; côté membre : écran de sanction à la place du site, page « Décisions du Greffe » (`/ma-fiche/decisions`), message retiré affiché au Parloir. Choix : 7-1 à 7-12.
  - La recherche par N° d'écrou, prévue d'abord, a été retirée : elle enfreignait la règle « aucune fonction ne prend le N° d'écrou en entrée » (test de la Phase 4).
  - Preview : `20261019130000_phase7a_moderation_types` appliquée par le connecteur (version = nom du fichier, MD5 identique). `20261019130100_phase7a_moderation` : le connecteur annule (des `delete` dans des corps de fonction) ; **appliquée par le porteur dans le SQL Editor le 2026-10-20**. Vérifiée : les 17 fonctions ont un corps identique au fichier (MD5 de `prosrc`), aucune à redéfinir ; droits identiques (helpers `private` au propriétaire seul, rien pour `anon`) ; 7 colonnes, l'index et la clé étrangère présents. Ligne d'historique : le connecteur annule aussi l'insertion (le texte du fichier contient des `delete`) → à lancer par le porteur dans le SQL Editor (règle n° 11 de CLAUDE.md, ajoutée le 2026-10-20). Types régénérés depuis la preview (seulement les ajouts 7a).
  - À traiter plus tard : signaler un message précis (la SPEC le prévoit ; `report()` ne gère pas encore la cible `message`, aucun bouton) — prévu en 7f ; `moderation_actions` en ajout seul empêche la suppression en cascade d'un compte — à régler en 7d.
- **7b — Pilotage** : quartiers et seuils, tribus, mots-clés, questions ; tableau de santé par quartier (indicateurs SPEC §15, `is_seed` exclus).
- **7c — Tâches planifiées** : Bonne conduite quotidienne, Fiches en veille (21 j) et masquées (90 j), ouverture automatique des quartiers (`ready_at`, prévenir l'admin une fois), nettoyage (comptes sans onboarding après 30 j, files envoyées) ; purges de fichiers et de comptes Auth par une route protégée.
- **7d — RGPD** : export JSON de mes données (SPEC §10, rien de l'autre personne), suppression réelle du compte (confirmation par mot de passe ; base, fichiers, abonnements push ; « Message supprimé » et « Ce compte a été supprimé » pour l'autre ; visites annulées) ; un banni ne peut pas se réinscrire avec le même e-mail.
- **7e — E-mails** : envoi par l'API HTTP de Brevo (offre gratuite, sans dépendance), file `email_outbox` avec priorités, quota du jour et report au lendemain, regroupement quotidien, rappels de visite sur option, désinscription par type ; en CI, un faux service Brevo.
- **7f — Parcours de bout en bout** prolongé (signalement → décision motivée → exposé des motifs ; export ; suppression du compte ; réinscription refusée), CI, docs, arrêt.

## Phase 6 — Le Parloir sans horaire et la Cavale (2026-10-19, terminée ; décisions 6-1 à 6-14 validées par le conseiller ; CI verte deux fois de suite sur `phase-6`)
Relu : PROMPT Phase 6, SPEC §7 ter, §10 (masquage), §13, §16, SCHEMA `date_proposals`, `can_unmask`, maquette `Permanent.dc.html`.
Découpage proposé (arrêt et validation à la fin de la phase, comme d'habitude ; sous-étapes livrées dans l'ordre) :
- **6a — Lu / non-lus** : dernier message lu par membre et par conversation (`mark_conversation_read`), indicateur « Lu », compteur de non-lus (onglet « Visites » et liste des Parloirs triée par activité), compteurs relus toutes les 60 s et au retour sur l'onglet. pgTAP.
- **6b — La Cavale en base** : `date_proposals` (types de lieu bar, café, concert, balade, activité ; nom du lieu ; date et heure futures), `propose_date`, `respond_date` (Accepter / Proposer autre chose / Pas encore), une seule en attente par conversation, conversation `open` exigée, avertissement « lieu privé » (conseil, pas blocage), notifications `date_proposed` / `date_accepted` / `date_countered` et Web Push neutre. pgTAP (tiers, blocage, affaire classée, dates passées).
- **6c — Levée du masquage** : `can_unmask` (règle à confirmer, question 1) appliquée par `send_message` ; jamais pendant une visite ; encart « Ne partage jamais d'argent ni de codes ». pgTAP.
- **6d — Écrans** : formulaire de Cavale, carte épinglée avec rappel des conseils sécurité, réponse, boutons Affaire classée / Proposer une Cavale au-dessus du champ toujours visible ; FR/EN.
- **6e — Parcours de bout en bout** prolongé (Cavale proposée → autre proposition → acceptée → coordonnées visibles ensuite → blocage : plus rien ne passe), CI, migrations sur la preview uniquement, docs, arrêt.
Questions tranchées le 2026-10-19 : voir « Décisions à valider ». Branche de phase `phase-6` (depuis `main`), avancée à chaque sous-phase dont la CI est verte.

### Rapport de fin de phase 6
**Fait (toutes les migrations sur la preview uniquement, texte enregistré identique aux fichiers, versions de l'historique = noms des fichiers ; rien sur `main`, rien sur la prod) :**
- **6a — Lu / non-lus** (`20261019100000_phase6a_conversation_reads`) : `conversations.bad_read_id` / `visitor_read_id` ; `mark_conversation_read` (jamais en arrière, jamais au-delà du dernier message), `get_read_state`, `get_unread_counts` (messages texte de l'autre, Parloirs sans horaire). Écrans : « Lu » sous mon dernier message lu par l'autre (cabine et Parloir sans horaire), conversation marquée lue quand elle est affichée, compteur de non-lus sur l'onglet « Visites » et sur chaque Parloir du Tableau ; la barre d'onglets est relue toutes les 60 s, au retour sur l'onglet et à chaque navigation (elle ne l'était qu'au premier affichage).
- **6b — La Cavale** (`20261019105900_phase6b_date_cancelled_type`, `20261019110000_phase6b_cavale`) : `date_proposals` (RLS, aucun droit direct), `propose_date`, `counter_date` (« Autre chose »), `respond_date` (Accepter / Pas encore), `cancel_date`, `get_dates` ; une seule proposition en attente, Permis permanent exigé, 1 h à 60 jours à l'avance, 24 h d'attente pour le proposant après « Pas encore », carte jusqu'au lendemain de la date (heure de France), avertissement « lieu privé » (`looks_private_place`, miroir `lib/cavale.ts`), lieu masqué et passé aux mots-clés ; blocage / affaire classée / changement de rôle annulent les Cavales ; notifications `date_proposed`, `date_countered`, `date_accepted`, `date_cancelled` (nouveau type) et Web Push neutre vers `/visites`.
- **6c — Levée du masquage** (`20261019120000_phase6c_unmask`) : `private.can_unmask` (Cavale acceptée au moins une fois, comptes de plus de 7 jours, aucun signalement ouvert entre les deux ni signalement ouvert arnaque / mineur / harcèlement / violence visant l'un d'eux) appliqué par `send_message` aux messages envoyés ensuite ; `get_conversation` renvoie `unmasked` (encart « Ne partage jamais d'argent ni de codes. »).
- **6d — Écrans** : carte de Cavale épinglée (couleur du genre de celui qui propose, rappel « Premier rendez-vous : lieu public, préviens un proche » + Conseils sécurité, annulation en un geste), réponses Accepter / Autre chose / Pas encore, formulaire (type de lieu, nom, jour, heure ; avertissement lieu privé en direct), boutons Affaire classée / Proposer une Cavale au-dessus du champ toujours visible ; FR/EN ; textes neutres du service worker.
- **6e — Tests** : pgTAP `phase6_parloir.test.sql` (7 groupes : lu / non-lus, règles de la Cavale, « Pas encore » et lieu privé, blocage, levée du masquage, jamais pendant une visite ; 12 fichiers, 108 tests verts) ; Vitest 186 ; parcours de bout en bout prolongé (étape 8 : non-lus et « Lu » ; étape 9 : Cavale « chez moi » avertie, autre proposition, acceptée, numéro en clair ensuite, ancien numéro toujours masqué ; étape 10 : push de la Cavale ; étape 11 : Bloquer au Parloir, plus rien ne passe) ; Pixel 7 **25/25** en local, axe sans violation sur le formulaire et la carte.
- **CI** : 6a verte (passage n° 23, `9ddd7d0`) ; 6b à 6e vertes (passage n° 24, `0332990`, Pixel 7 et iPhone 14) ; `phase-6` avancée jusqu'au rapport de fin de phase.

**Écarts :**
- 6b, 6c, 6d et 6e sont passées en CI ensemble : les écrans de la 6b avaient besoin des types de la 6c (même fichier de types généré) ; la 6a, elle, a eu sa CI verte avant la suite.
- Relance à 48 h « Toujours là ? » : [P1], non faite. « Compte supprimé » : Phase 7 (décision 6-6). E-mail « Cavale acceptée » : Phase 7 (e-mails).
- Bonne conduite (calcul quotidien, absences du Bad) : toujours Phase 7.

**Questions :** les choix pris en cours de phase sont listés dans « Décisions à valider » (6-7 à 6-14).

**CI n° 25 rouge sur `phase-6` (iPhone 14, étape 8, compteur « non lu » resté affiché), 2026-10-19 — cause et correction :**
- Défaut du test : il attendait `visitor_read_id > 0`, déjà vrai depuis la visite ; il repartait donc au Tableau avant que le nouveau message soit marqué lu.
- **Vrai défaut du code** : la lecture n'était marquée que par le navigateur, après l'affichage (action serveur) ; quitter la page tout de suite (plus lent sous WebKit) annulait l'envoi et le compteur restait. Correction : ouvrir une conversation la **marque lue côté serveur** jusqu'au dernier message rendu (`markRendered`, cabine et Parloir sans horaire) ; le navigateur ne marque plus que les messages arrivés ensuite.
- Retour par « précédent » : le routeur réaffiche sa copie en cache ; le Tableau des visites se relit désormais après un retour ou une avance (`FreshOnReturn`), la barre d'onglets se relisait déjà à chaque changement d'adresse. Le parcours revient maintenant par « précédent » et vérifie la lecture sur le message lui-même.
- Vérifié en local : Pixel 7 25/25 puis le parcours deux fois de plus ; CI sur `phase-6` : passage n° 27 (`f4ecf25`) vert, relancé une fois, vert à nouveau (Pixel 7 et iPhone 14).

## Phase 5 — Notifications, Heures de visite, Visite (2026-10-06 → 2026-10-18) : ✅ validée, fusionnée (PR #12) et en production

### Découpage (validé)
5a Web Push → 5b Heures de visite → 5c Visite. Arrêt, rapport et test sur téléphone après chacune.

### Décisions (Chris, 2026-10-06)
- Option A pour les secrets : clé publique VAPID, clé privée VAPID, contact VAPID et secret de la route en **variables Vercel** (clé privée et secret en type « sensitive »). Le **coffre Supabase (Vault)** ne contient que ce dont pg_net a besoin : l'URL appelée, le secret de la route, le jeton de contournement de la preview. La clé privée VAPID ne va jamais dans le coffre.
- Les secrets sont générés dans le shell et posés sans jamais être affichés. Chris autorise le connecteur Vercel pour les poser, en connaissance de cause.
- Test réel sur la preview : jeton de contournement de la protection Vercel, réservé à la preview, rangé dans le coffre.
- iPhone : accepté, avec le guide d'installation (`/installer`).
- Fin de visite (5c) : choix cachés aux deux participants, lus uniquement par une fonction, attente qui interroge toutes les 5 s.

### 5a — fait (vérifié)
- **Base** (`20261006173557_phase5a_web_push`) : `push_subscriptions` (aucun droit direct des membres, uniquement des fonctions ; 5 navigateurs au plus ; un abonnement coupé ou expiré garde sa ligne mais perd adresse et clés), `push_outbox` alimentée par un déclencheur sur `notifications` (préférences par type, une seule notification Greffe par jour, contenu = un chemin interne seulement), `push_claim` (bail de 5 min) / `push_report`, `push_dispatch` lancé chaque minute par pg_cron, qui n'appelle la route via pg_net que s'il y a quelque chose à envoyer. pgTAP `phase5a_push.test.sql` : 7 groupes, 44 assertions vertes ; contrôles globaux propres (RLS partout, rien pour anon).
- **Route** `/api/cron/push` (Node) : secret comparé en temps constant, envoi par `web-push` (TTL 24 h), 404/410 → abonnement coupé, autre échec → nouvel essai, abandon après 3 tentatives, abonnement coupé après 5 échecs de suite.
- **Service worker** `public/sw.js` : textes neutres FR/EN par type (jamais de pseudo, de photo ni de message), aucun cache, aucun `fetch`. Enregistré seulement quand le membre active les notifications, jamais sur la landing. `/sw.js` servi en `no-cache` avec sa propre CSP.
- **Interface** : proposition après la 1re demande envoyée (Visiteur, `/demandes`) ou la 1re acceptée (Bad, `/courrier`), jamais à l'arrivée ; « Plus tard » ou un refus du navigateur respectés 30 jours ; guide iPhone `/installer` (écran d'accueil, iOS 16.4+) ; Ma Fiche › Notifications (cet appareil, nombre d'appareils, 3 types). Politique de confidentialité complétée (ce qui est gardé, quand c'est effacé).
- **Vérifications** : lint, typecheck, Prettier, build ; 151 tests unitaires ; e2e 51 verts, 9 sautés (doublons desktop prévus), dont : aucun service worker sur `/`, route 401 sans secret, proposition visible puis masquée par « Plus tard ».

### 5a — reste
- [x] Migration `phase5a_push_vault_reads` (appliquée hors du repo) versionnée, puis neutralisée par `phase5a_push_secret_names` : le coffre n'accepte plus que `push_endpoint_url`, `push_cron_secret`, `vercel_protection_bypass` ; la clé privée VAPID y est refusée (test pgTAP). La fonction `push_route_config()` reste en base (le connecteur a annulé son `DROP`, qui demande une confirmation) : réservée à la clé secrète, inutilisée, elle ne renvoie rien puisqu'aucun secret correspondant n'existe.
- [x] `DROP FUNCTION push_route_config()` : exécuté par Chris dans le SQL Editor (version `20261006190000` enregistrée). pgTAP `phase5a_push.test.sql` relancé : **7 groupes, 45/45**, dont `hasnt_function('push_route_config')`.
- [x] Secrets posés par le conseiller (2026-10-06) : sur Vercel (Preview et Production) les 4 variables, `VAPID_PRIVATE_KEY` et `PUSH_CRON_SECRET` en sensitive, `VAPID_SUBJECT` = URL du site ; dans le coffre `push_cron_secret` et `vercel_protection_bypass`.
- [x] Coffre : `push_endpoint_url` → `https://bad-boys-bad-girls-git-phase-5-riuk.vercel.app/api/cron/push`.
- [x] **Défaut trouvé à la vérification** : `NEXT_PUBLIC_SUPABASE_URL` valait `…supabase.co/rest/v1/` sur Vercel depuis le 2026-10-03 → toutes les requêtes du site déployé partaient vers `/rest/v1/rest/v1/…` (404 PGRST125 ; la route push répondait 500 `claim_failed`). Corrigée en URL de base (Preview et Production ; la production la prendra au prochain déploiement). Les tests locaux ne pouvaient pas le voir (`.env.local` correct).
- [x] Preview redéployée (`dpl_J4YpzxZ8W5c8dNnZV727iXcQu81b`, `800e46d`). Appel pg_net avec les secrets du coffre : **200 `{"sent":0}`** (secret, jeton de contournement, variables VAPID et clé secrète Supabase validés) ; sans secret : 401.
- [x] `push_outbox` → `sent` : prouvé en CI par la route contre un faux service de push (déchiffrement, VAPID) et par le parcours de bout en bout. Le test sur vrais téléphones passe dans la checklist d'avant lancement (décision du porteur, 2026-10-07).
- [ ] SCHEMA : écarts (révocation douce, pas de lecture des abonnements par les membres, colonne `locale`, message = chemin seulement).

### 5a-ter — Super admin et double authentification (2026-10-07, validée et fusionnée dans `phase-5`)
Décisions du porteur : aucun rôle admin sur un compte de test, Toulon jamais ouvert sur la base partagée ; **c'est Claude qui teste** ; super admin intouchable ; TOTP obligatoire pour `/admin`.
Découpage annoncé : a base (super_admins, gardes, aal2, script, pgTAP) · b double authentification (`/acces-admin`) · c invisibilité · parcours de bout en bout en CI · docs.
- **Base** (`20261007100308_phase5a_ter_super_admin`, appliquée sur dev) : table `super_admins` (RLS, aucun droit pour aucun rôle) ; garde `private.is_database_owner_session()` = session **et** rôle courant `postgres`, aucune identité JWT, pas pg_cron (vérifié sur le projet hébergé : connecteur et SQL Editor tournent en `postgres/postgres` sans claims). Triggers (droits de l'appelant, jamais `security definer`) : `super_admins` (ajout, modification, suppression, vidage), `auth.users` (suppression, suppression douce `deleted_at`, `banned_until`), `profiles` (création, modification, suppression : pas de profil, donc ni suspension ni masquage), `banned_email_hashes` (empreinte de son e-mail). Fonctions d'aide dans le schéma **`private`** (non exposé par l'API : un membre ne peut pas demander si un id est super admin) ; `usage` accordé à `authenticated`, `service_role`, `supabase_auth_admin` (sinon chaque connexion, qui met à jour `auth.users`, échouerait — vérifié sur dev). `is_admin()` exige **aal2** ; `my_admin_role()` (sans exigence aal) sert au lien Admin et à la redirection.
- **Script** `supabase/scripts/grant_super_admin.sql` : propriétaire seulement, compte existant, **aucun profil** (sinon refus), idempotent (vérifié).
- **Double authentification** : `/admin` (layout) → 404 si pas admin, `/acces-admin` si aal1 ; `/acces-admin` : enrôlement TOTP (QR code + clé à saisir), puis code à 6 chiffres (`components/admin/admin-mfa.tsx`, Supabase Auth MFA côté navigateur) ; MFA TOTP activée dans `supabase/config.toml`. Lien Admin de l'en-tête via `my_admin_role()`.
- **Invisibilité** : le super admin n'a pas de profil ; `/onboarding` et `/onboarding/[step]` le renvoient à `/admin`.
- **Tests** : pgTAP `phase5a_ter_super_admin` **7 groupes, 49 vérifications** (octroi, retrait, suppression, bannissement, profil, aal2, structure ; appelants : lui-même, autre admin aal2, clé secrète, fonction `security definer`, pg_cron ; contrôle : les autres comptes ne sont pas concernés ; le propriétaire peut tout) ; `phase2_security` et `phase3_greffe` adaptés (admin sans aal2 refusé) ; Vitest `admin-guard` (4) ; e2e `super-admin.spec.ts` contre le **vrai service Auth** local (`deleteUser`, suppression douce, `ban_duration` refusés ; clé secrète refusée ; connexion → `/acces-admin` → Greffe, jamais l'onboarding). Le greffier de `onboarding-complete` passe maintenant la double authentification (`tests/e2e/helpers/admin.ts`, TOTP RFC 6238 calculé dans le test).
- **Parcours de bout en bout** `tests/e2e/journey.spec.ts` (Pixel 7 et iPhone 14) : Bad et Visiteur à Toulon avec photos en attente → admin de test (TOTP) valide les 4 photos au vrai Greffe, **fichiers présents dans le stockage public** sous un nom aléatoire → Toulon ouvert (base locale) → `can_view_bad` vrai → Découverte → Fiche → Demande de parloir → Courrier → « Accepter la visite » → `/api/cron/push` : le Bad reçoit `request_received` (/courrier), le Visiteur `permit_granted` (/ma-fiche) et `request_accepted` (/demandes), chaque message = type + chemin seulement. Toulon remis en liste d'attente à la fin. **À prolonger à chaque phase** (visite, Parloir, Permis permanent, Cavale).
- **Vérifié en local** : typecheck, lint, Prettier, Vitest 160/160, build, pgTAP 8 fichiers (79), Pixel 7 **17/17**.
- **CI** : passage n° 6 rouge (2 défauts de test, corrigés à la racine : axe mesurait les contrastes pendant le fondu d'ouverture d'une fenêtre ; le helper admin n'attendait pas la dernière redirection du super admin sous WebKit) ; **passage n° 7 vert en 5 min 54 s** (`00a01b3`, run 37607074349) : **30 réussis, 4 sautés à dessein (route push sur WebKit), aucun second essai**, parcours de bout en bout vert sur Pixel 7 **et** iPhone 14.
- **À vérifier par toi** : TOTP activé sur le projet hébergé (Authentication → Multi-Factor ; activé par défaut chez Supabase, non vérifiable depuis le connecteur). Le super admin s'accorde avec le script, puis la première connexion à `/admin` enrôle l'application d'authentification.

### Défaut corrigé (2026-10-18) : récupération de mot de passe du super admin
- **Constat** (journaux Auth de la preview, 18/10 10:25 UTC) : `/verify` du lien de récupération réussi, aucune mise à jour du mot de passe ensuite.
- **Cause** (reproduite sur la pile locale) : pas la garde de `/admin` (aucune redirection ne touche `/nouveau-mot-de-passe`), mais **Supabase Auth**, qui refuse tout changement de mot de passe sous **aal2** pour un compte doté d'un second facteur vérifié : `401 insufficient_aal` (« AAL2 session is required to update email or password when MFA is enabled »). La session ouverte par le lien est en aal1.
- **Correction** : `/nouveau-mot-de-passe` détecte une session aal1 avec un facteur TOTP vérifié et demande d'abord le code (passage en aal2), puis le nouveau mot de passe ; le message `insufficient_aal` est traduit. Rien n'est assoupli : il faut le lien **et** le second facteur ; la garde de `/admin` (aal2 à chaque session) est inchangée.
- **Test** : `tests/e2e/password-recovery.spec.ts` (parcours critiques, Pixel 7 et iPhone 14) : un membre (lien → nouveau mot de passe → connexion avec le nouveau, l'ancien refusé) ; le super admin (lien → code demandé, mauvais code refusé, bon code → nouveau mot de passe → connexion ; une nouvelle session passe toujours par `/acces-admin`). Vérifié : sans la correction, le test du super admin échoue.
- **À savoir** : un super admin qui aurait perdu son application d'authentification ne peut pas récupérer seul son compte (voulu) ; il faut retirer son facteur en base, en propriétaire. Le mot de passe temporaire posé par le conseiller peut maintenant être remplacé par le parcours normal.

### Promenade en mode ouvert (2026-10-18, correctif validé, dans `phase-5`)
- **Vérifié** (la preview est passée en `launch_mode = 'open'`) : la Promenade était construite par quartier seulement (`build_daily_promenade(zone)` prend les Visiteurs `zone_id = zone`, la tâche horaire ne parcourt que `launch_zones`). **Un Visiteur hors de tout quartier (`zone_id` vide) n'avait jamais de Promenade**, même en mode ouvert ; la Découverte, elle, fonctionnait. Les Bads hors quartier étaient bien proposés (mode ouvert) ; les Visiteurs d'un quartier en liste d'attente aussi. Preview : 1 seul membre réel (un Bad hors quartier), aucun Visiteur, donc défaut non observable en vrai, démontré par le test.
- **Correctif** `20261018150000_phase5_promenade_open_mode` (commit `8669bf3`, approuvé par le porteur le 2026-10-18 ; appliqué sur la preview, texte identique au fichier, version de l'historique remise à `20261018150000` ; `phase-5` avancée à `1c76403`) : en mode ouvert, une Promenade de plus pour les membres hors quartier (`zone_id` vide), à 21 h heure de France, mêmes Bads, même plafond de 10 apparitions par Bad et par jour (plafond commun à toutes les Promenades), mêmes règles ; en mode quartiers rien ne change. Mêmes signatures, pas de DROP.
- **pgTAP** `phase5_promenade_open.test.sql` : sans le correctif, 5 vérifications sur 8 échouent (rien pour le Visiteur hors quartier) ; avec, tout passe ; mode quartiers inchangé ; fonctions réservées à la tâche. Non testé : le déclenchement par l'heure dans `run_promenades_due` (dépend de l'horloge), relu.

### Reste pour fusionner `phase-5` dans `main`
1. ~~Correctif Promenade~~ : validé, dans `phase-5`.
2. ~~Production avant la fusion~~ (la fusion redéploie la prod aussitôt) : 10 migrations appliquées et vérifiées (voir « Bases Supabase »). Les 11 migrations sont en prod (le DROP lancé par le porteur le 2026-10-19).
3. Vérification de la prod par le conseiller.
4. Pull request `phase-5` → `main`, CI verte, fusion par le porteur.
5. Rien dans le coffre de prod ni dans les variables Vercel : les notifications de prod auront leurs propres clés au lancement (checklist).
6. Super admin de la prod (`grant_super_admin.sql`, TOTP), puis retrait de tout connecteur d'IA en écriture sur la prod.
7. La prod reste en `launch_mode = 'zones'` et `SIGNUPS_OPEN=false` tant que la checklist avant lancement n'est pas faite (vrais téléphones, Turnstile, SMTP, limite Realtime, clés de notification).

### 5c — La visite au Parloir (2026-10-18, validée le 2026-10-18 avec compléments, fusionnée dans `phase-5`)
Découpage annoncé : 5b-bis compléments + fusion · 5c-1 base · 5c-2 écrans · 5c-3 parcours prolongé, CI, preview, docs, arrêt.
- **Base** (`20261018104313_phase5c_parloir`, **appliquée sur la preview uniquement**, SQL enregistré identique au fichier, types régénérés) : `conversations`, `messages` (lecture RLS par les deux membres pour Realtime, publication `supabase_realtime`), colonnes de présence / absence / choix de fin / issue sur `visits`. Fonctions membres : `join_visit`, `get_visit`, `choose_visit_end`, `send_message`, `get_messages`, `get_conversation`, `get_my_parloirs`, `close_conversation`. Tâche `parloir-ticks` chaque minute : début (conversation, « la visite commence »), absence à +10 min (report de 48 h, deuxième absence → classée), fin à +30 min (24 h pour choisir), choix échus. Règle 14 : le pari et le mot ne sont révélés que lorsque les deux sont présents. Bloquer annule la visite en cours et ferme le Parloir ; changement de rôle : Parloirs sans horaire classés ; « Visites honorées » compte maintenant les absences du Visiteur. Audit sécurité : rien d'inattendu.
- **pgTAP** `phase5c_parloir.test.sql` : 7 groupes (structure et droits, début et révélation, messages : présence, 1 000 caractères, masquage, 30/min, fin des 30 min ; absence et deuxième absence ; Permis permanent, choix secrets, messages sans horaire, notification 15 min, « Affaire classée » ; classement par refus ou sans réponse ; blocage). **10 fichiers verts.**
- **Écrans** : `/visites/[visite]` (plaque rivetée « PARLOIR · CABINE nn », hygiaphone, Signaler / Bloquer, « En attente de … », compte à rebours sur l'horloge de la base, fiche papier du pari avec tampon BIEN VU ! / RATÉ !, mot du Visiteur, bulles au contour de la couleur du genre de l'auteur, fin de visite Prolonger / Affaire classée, tampons PERMIS PERMANENT / AFFAIRE CLASSÉE, absence et lien pour reproposer) ; `/visites/parloir/[conversation]` (« PARLOIR · SANS HORAIRE », champ toujours visible, « Affaire classée » avec confirmation, conseil premier rendez-vous + Conseils sécurité) ; Tableau des visites : « Entrer au Parloir », « Fin de visite : à toi de choisir », Parloirs sans horaire. Textes FR/EN, textes de notification neutres (sw.js).
- **Parcours de bout en bout** prolongé (`journey.spec.ts`, étapes 6 à 9) : visite ramenée à « maintenant » (base locale) → le Visiteur entre, attend → le Bad entre → pari révélé (BIEN VU !) → messages dans les deux sens, numéro masqué → fin des 30 min → le Visiteur prolonge (le Bad ne voit rien de ce choix) → le Bad prolonge → PERMIS PERMANENT des deux côtés → base : visite `released`, affaire `released`, conversation `open` → Parloir sans horaire, message lu par l'autre → push : `visit_starting`, `visit_released`, `message_received` (/visites). axe sans violation sur la cabine, la fin de visite et le Parloir sans horaire.
- **Vérifié en local** : typecheck, lint, Prettier, Vitest 178/178, build, pgTAP 10 fichiers, Pixel 7 **23/23** (avec la récupération de mot de passe).
- **CI** : passages n° 12 à 14 rouges sur iPhone 14 seulement. Cause réelle (journaux d'erreurs de page ajoutés au parcours) : la CSP n'autorisait le WebSocket Realtime qu'en `wss://` (dérivé d'une URL `https://`) ; avec la base locale en `http://`, WebKit refuse `ws://` et lève une exception à l'ouverture de la conversation → page d'erreur côté Visiteur (Chromium tolérait). Production non concernée (`wss://…supabase.co` déjà présent). Corrections : `ws://` pour une URL `http://` (`lib/security/csp.ts`, test unitaire), la conversation repasse en relève toutes les 3 s si le WebSocket est refusé, la relève de la visite survit à une requête perdue. La remise au premier plan (n° 12) n'était pas la cause. **Passage n° 15 vert** (`3fd080a`, run 39123374627) sur Pixel 7 et iPhone 14.
- **Écarts / non faits** : la Cavale (Phase 6, bouton remplacé par une mention) ; indicateur « lu », compteur de non-lus et « … est en train d'écrire » ; relance à 48 h (P1) ; Bonne conduite (calcul quotidien) ; levée du masquage ; e-mails.
- **Réponses du porteur (2026-10-18)** :
  1. Absence : oui. L'absence compte dans « Visites honorées » de l'absent (Visiteur : `visitor_reputation`, déjà en place ; Bad : dans Bonne conduite, dont le calcul quotidien reste à faire). **Visiteur absent : le Bad peut reproposer ou classer l'affaire, sans obligation** → `close_after_absence` (`20261018114947_phase5c_absence_close`, appliquée sur la preview uniquement, SQL identique au fichier) ; sans nouvelles Heures, l'affaire est classée à 48 h comme avant. « Classer l'affaire » dans le Courrier et dans la cabine ; refusé si c'est le Bad qui était absent. pgTAP `test_parloir_visitor_absent` (reproposition, classement) : 10 fichiers verts.
  2. Choix de fin définitif : oui (inchangé).
  3. Coordonnées masquées jusqu'à ce qu'une Cavale soit acceptée (Phase 6) : oui (inchangé).
  4. Limite de connexions Realtime : ajoutée à la checklist avant lancement.

### 5b — Heures de visite (2026-10-07, validée le 2026-10-18 avec compléments, fusionnée dans `phase-5`)
Découpage annoncé : 5b-1 base · 5b-2 logique pure · 5b-3 écrans du Bad · 5b-4 écrans du Visiteur · 5b-5 parcours prolongé, specs adaptées, CI, docs, arrêt.
- **Base** (`20261007184105_phase5b_visiting_hours`, **appliquée sur dev**, types régénérés) : `visit_slots`, `visits` (contraintes d'exclusion btree_gist Bad et Visiteur, une visite programmée par demande), aucun droit direct des membres. Fonctions : `accept_visit_request` (accepter = 2 ou 3 créneaux), `decide_visit_request` (ne fait plus que classer, signature gardée), `propose_slots`, `choose_slot`, `decline_slots` (une fois), `cancel_visit` (< 2 h = `cancelled_late`), `get_request_schedule`, `get_my_visits`, `run_visit_schedule` (pg_cron `visit-schedule` chaque minute : classements à 48 h, rappel 1 h, début). Déclencheur : une demande qui quitte « acceptée » annule sa visite et expire ses créneaux. `push_path` : `slot_chosen`, `visit_reminder_1h`, `visit_starting` → `/visites`. Advisors sécurité : rien de nouveau hors les avertissements attendus (fonctions membres `security definer`, tables sans politique lues par fonctions).
- **pgTAP** `phase5b_hours.test.sql` : 11 groupes (structure, règles d'acceptation, choix, chevauchements Bad et Visiteur, « Aucun ne me va » puis nouveaux créneaux, délais, rappels, annulation, blocage, règle 14 et push). `phase4_relations` adapté. **9 fichiers, 90 tests verts.**
- **Logique pure** `lib/hours.ts` (heure locale du quartier, raccourcis « Ce soir » / « Demain soir » / « Ce week-end » selon SPEC §7 bis, jours et heures au choix, libellés) : Vitest 10 tests.
- **Bad** : « Accepter la visite » → `/courrier/[id]/heures` (maquette Heures.dc.html : raccourcis, liste des créneaux retirables, jour et heure au choix, « Envoyer mes Heures de visite ») ; la demande affiche ensuite les créneaux en attente, la visite programmée (annulable) ou l'invitation à reproposer.
- **Visiteur** : « Mes demandes » montre les créneaux à choisir (grisés « plus disponible »), « Confirmer : … », « Aucun ne me va » (une fois), l'attente de nouveaux créneaux, ou la visite programmée (annulable).
- **Tableau des visites** `/visites` + onglet **« Visites »** pour les deux rôles (pastille : créneau choisi, annulation, rappels).
- **Parcours de bout en bout** prolongé : le Bad accepte avec « Demain soir » + un créneau au choix → base : tour 1, 2 créneaux `offered`, délai de choix posé → le Visiteur choisit le premier et confirme → base : 1 visite `scheduled` de 30 min, créneau `chosen` → les deux la voient dans le Tableau des visites → push : le Bad reçoit aussi `slot_chosen` (/visites). `relations.spec.ts` adapté (acceptation par les Heures de visite, axe sur l'écran, onglets).
- **Vérifié en local** : typecheck, lint, Prettier, Vitest 170/170, build, pgTAP 9 fichiers (90), Pixel 7 **18/18**.
- **CI** : passage n° 9 **vert en 5 min 03 s** (`e476774`, run 37668792130), parcours de bout en bout vert sur Pixel 7 et iPhone 14.
- **Écarts** : `visits` sans conversation, présence, absence ni choix de fin (5c) ; pas de lecture directe de `visits` (temps réel à décider en 5c) ; e-mails de rappel non branchés (SMTP, plus tard) ; pas d'écran « bas de page » de compteurs (`get_counters`).
- **Décisions du porteur (2026-10-18)** et compléments (`20261018102017_phase5b_complements`, appliquée sur la preview uniquement) :
  1. Après une annulation, le Bad a 48 h pour reproposer, **une seule fois** : une deuxième annulation dans la même affaire la classe (`close_reason = second_cancellation`, message neutre au Visiteur). pgTAP : `test_hours_cancel` prolongé.
  2. Une annulation à moins de 2 h par le Visiteur compte comme **visite due et non honorée** (`visitor_reputation` : honorées = visites tenues ; dues = visites tenues + annulations tardives du Visiteur ; la 5c y ajoute les absences). pgTAP : `test_hours_late_cancel_reputation`.
  3. Le Parloir vit dans l'onglet **« Visites »** (pas d'onglet à part).
  4. Acceptation sans créneaux impossible : conservé (5b validée).
  5. **Règle preview / prod** (remplace l'ancienne note sur l'ordre migration → déploiement) : les migrations d'une phase en cours vont **uniquement sur la preview** (`bad-boys-preview`) ; la production (`bad-boys-prod`) ne reçoit que les migrations de `main`, avec le contenu exact des fichiers, une fois la phase fusionnée et sur accord du porteur.

### 5a-bis — Intégration continue (2026-10-06, validée le 2026-10-07)
Découpage annoncé : 1 socle CI · 2 base locale reproductible · 3 Playwright Pixel 7 / iPhone 14 · 4 test de la route push · 5 mesure, PROGRESS, arrêt.
- **Workflow** `.github/workflows/ci.yml` : un seul job `ubuntu-24.04`, `timeout-minutes: 15`, Node 24 (comme Vercel), sur chaque push ; une PR depuis une branche du dépôt n'est pas relancée (le push du même commit la vérifie déjà), seules les PR de forks le sont. `supabase start` et l'installation des navigateurs tournent en arrière-plan pendant typecheck / lint / Prettier / Vitest (`scripts/ci/wait-for.sh`).
- **Aucun secret** : `scripts/ci/local-env.mjs` refuse de tourner si la pile n'est pas en `127.0.0.1`, génère clés VAPID, secret de la route et certificat TLS jetable, masqués dans les journaux ; les clés Supabase sont celles de la pile locale.
- **Base locale** : les 29 migrations passent depuis une base vide ; pgTAP complet (`supabase test db`) 7 fichiers verts en 58 s. Fixtures locales chargées par `supabase start` : communes 83/06 (`supabase/fixtures/places-83-06.sql`, geo.api.gouv.fr) ; les quartiers Toulon / Nice viennent de la migration `20261007074353_launch_zones_toulon_nice` (voir décisions du 2026-10-07). Confirmation d'inscription par e-mail activée en local (Mailpit), comme en production.
- **E2E** (projets `pixel-7` Chromium et `iphone-14` WebKit Linux, en CI ou avec `E2E_DEVICES=true`) : `signup` (porte Visiteur → formulaire → e-mail Mailpit → lien → étapes 1-2 → rôle présélectionné), `onboarding-complete`, `relations` (Demande de parloir, Courrier, acceptation), `push-route`. Local Pixel 7 : **10/10 en 33 s** ; iPhone 14 non exécutable ici (WebKit absent), vérifié en CI seulement.
- **Test push** (`tests/e2e/push-route.spec.ts`, `helpers/fake-push-service.ts`) : faux service de push HTTPS ; 401 sans secret, avec un mauvais secret, ou sans « Bearer » ; 200 avec ; signature VAPID ES256 vérifiée (clé, audience, sujet, expiration ≤ 24 h) ; message déchiffré (aes128gcm) = exactement `{"t":"request_received","u":"/courrier"}`, ni pseudo ni mot ; outbox `sent` ; le vrai service worker (Chromium, CDP) affiche le texte neutre « Du courrier » sous l'origine du site ; 410 → abonnement révoqué.
- **Défaut trouvé** : `web-push` refuse un `VAPID_SUBJECT` en `http:` (seuls `https:` et `mailto:`) ; l'erreur est alors classée en échec et le message abandonné après 3 essais, sans trace. En production la valeur est l'URL https du site : OK. En CI : `https://localhost:3100`.
- **Écarts / limites** : Turnstile non chargé (pas de clé locale ; le captcha est vérifié par Supabase Auth en production) ; iPhone 14 = moteur WebKit sous Linux, pas iOS Safari, et sans Web Push ; « titre = domaine » : le titre affiché est le texte neutre du service worker, le domaine est la ligne d'origine qu'Android ajoute (vérifié : origine du service worker = site).
- **Passages GitHub Actions** : n° 1 rouge (4 échecs), n° 2 rouge (1), **n° 3 vert en 7 min 06 s** (`5b8e65a`, run 37534962220) : install 17 s, typecheck 50 s, lint 23 s, Prettier 11 s, Vitest 151/151 19 s, attente Supabase 7 s, build 51 s, **pgTAP 7 fichiers 65 s**, **e2e 16 réussis + 4 sautés à dessein (route push sur WebKit) en 2 min 23 s**. Environ 7 min facturées par push : ~280 passages par mois dans les 2 000 minutes gratuites.
- **Défauts trouvés par la CI** (tests, pas application) : le Chromium « headless shell » n'a ni `Notification` ni `PushManager` → projet Pixel 7 sur le Chromium complet (`channel: "chromium"`) ; WebKit interrompait la navigation suivante pendant la redirection de `/onboarding` → attente de la page finale ; sur iPhone hors écran d'accueil l'invite mène au guide `/installer` (comportement voulu), le test l'attend désormais.
- **Décisions de Chris (2026-10-07)** et suites :
  1. La CI reste sur des comptes jetables (« avec le seed » abandonné). `seed_dev.sql` réparé a minima : chaque membre fictif est un Bad (`role = 'bad'`), sans réécriture v2 (ni Casier, ni photos) ; vérifié sur pile neuve : 200 membres créés.
  2. Production : déjà redéployée après la correction de `NEXT_PUBLIC_SUPABASE_URL` (`dpl_A6DTC8HeFY6m6BXi6hWKJnZkDTQ5`, `main` 78b4693) ; CSP = URL de base. Vérifié : `/` et `/connexion` en 200 ; une connexion avec un compte inexistant appelle `POST /auth/v1/token` → 400 (identifiants), aucun 404, aucun `/rest/v1/rest/v1` depuis.
  3. `/api/cron/push` : un `VAPID_SUBJECT` ni `https:` ni `mailto:` → **503 `push_misconfigured`** avant tout accès à la base (`isValidVapidSubject`, `tests/unit/push-route.test.ts`, 5 tests).
  4. Migration idempotente `20261007074353_launch_zones_toulon_nice` (communes centres + quartiers, `on conflict do nothing`), appliquée sur dev (aucun changement : 2 quartiers) ; `supabase/fixtures/launch-zones.sql` retiré. La future base de production les aura par les migrations.
  5. CI : `paths-ignore: ["docs/**", "**/*.md"]` sur le push.
- ~~Question ouverte~~ (tranchée ci-dessus) : le seed de dev (`supabase/scripts/seed_dev.sql`) échoue sur le schéma actuel (`profiles_completion_role_check` : aucun rôle) et ses membres (`is_seed`) sont exclus par conception de la Promenade, de la Découverte et des demandes. Les parcours utilisent donc des comptes jetables non-seed créés dans la base locale.

### Points à connaître
- Si un navigateur renouvelle de lui-même son abonnement, l'ancien est coupé au premier envoi refusé (410) ; il faut réactiver dans Ma Fiche (pas de `pushsubscriptionchange`).
- Le titre affiché par le téléphone est le nom de l'app installée (iPhone) ou le domaine (Android) : il révèle le site, pas le contenu.

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

### Décisions de Chris (2026-10-06, après relecture du conseiller)
- **Promenade par paliers** (`20261006112943_phase4_promenade_tiers`) : d'abord 1 Bad pour chaque Visiteur, puis un 2e, et ainsi de suite jusqu'à 5, dans la limite inchangée de 10 apparitions par Bad et par jour. Mesuré : saturé 1 000 Visiteurs × 200 Bads → **1 000 servis sur 1 000, 2 Bads chacun**, 3,8 s (avant : 17 % sans aucun Bad) ; 600 × 1 000 → 7,8 s, tous servis. Test pgTAP saturé : 0 % de Visiteurs sans Bad tant qu'il reste des places, écart d'au plus 1 Bad entre Visiteurs. Sans saturation, le résultat reste identique au builder 4a (test d'équivalence, plafond relevé à 1 000).
- **Encre or sur crème `#765A0E`** validée : PARCOURS-DESIGN, SPEC et la maquette du Courrier mis à jour.
- **Anglais validé** : Promenade = « The Yard », Courrier = « Mailbox », Casier = « Record », Parloir = « visiting room », Greffe = « Registry ».
- Limites Phase 4 (inchangées) : pas de créneaux de visite (Phase 5), onglets Visites / Parloir masqués, notifications dans l'application seulement.

### pgTAP complet relancé après les paliers (2026-10-06, tout vert)
- `phase4_relations` : **14/14 groupes, 194 vérifications** (règle 14 59, formes 9, tables fermées 12, N° d'écrou 10, limites 17, Parloir complet 6, anti-arnaque 2, visibilité 13, blocages 14, mes blocages / notifications 8, changement de rôle 10, signalement 15, Promenade 13, droits 6).
- `phase4_perf` : Découverte 6/6 (40 ms par page sur 1 000 Bads), Promenade 600 × 1 000 3/3, équivalence 4a 2/2, saturé 4/4.
- `phase3_complicity_parity` 69/69 ; `phase3_security` 17/17 groupes ; `phase3_greffe` 7/7 ; `phase2_security` 22/22.
- Base revérifiée vide, `app_settings` inchangé (`zones` / 10).

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
1. ~~**Un seul projet Supabase** (`chvnmzmvcjvhxlnfmlvv`) sert le dev **et** la production Vercel.~~ Depuis le 2026-10-17 : preview `bad-boys-preview` (`chvnmzmvcjvhxlnfmlvv`) et production `bad-boys-prod` (`hmmobtyherwuhrhymfbk`), voir « Bases Supabase ». La production actuelle (code de la Phase 2c) ne peut plus terminer un onboarding avec la base de la Phase 3 ; elle le pourra une fois la PR de la Phase 3 fusionnée, et `SIGNUPS_OPEN=false` y ferme les inscriptions. Base de production séparée : checklist avant lancement.
2. **Le connecteur Supabase annule tout script contenant un `DELETE`**, même dans un test annulé ensuite. Les tests pgTAP de la Phase 3 vérifient donc les suppressions par les droits et les politiques (catalogue), sans exécuter de `DELETE`.
3. **Mots-clés de modération chargés** (migration `20261005152114_moderation_keywords`, 108 mots relus, sans « signal », `harassment` vide jusqu'à l'admin de la Phase 7) ; test pgTAP : un chef d'accusation qui contient un mot-clé est signalé.
5. **`SIGNUPS_OPEN` fermé par défaut** : seule la valeur exacte `true` ouvre les inscriptions (absente ou autre valeur = fermées), test unitaire ; Vercel vérifié : `false` en Production, `true` en Preview et Development.
4. Le fichier pgTAP de parité est **généré** depuis le fichier de cas (`UPDATE_PGTAP=1 pnpm vitest run tests/unit/complicity.test.ts`) ; le test unitaire échoue s'il n'est pas à jour.

## Checklist avant lancement (ouverture des inscriptions)
- [ ] **Base Supabase de production séparée** (décision du porteur, 2026-10-05 : pas pour l'instant, une base gratuite inactive se met en pause au bout de 7 jours). La créer juste avant l'ouverture : appliquer toutes les migrations, premier admin, Turnstile, SMTP, variables Vercel Production.
  - 2026-10-17 : créée (`bad-boys-prod`, `hmmobtyherwuhrhymfbk`), inscriptions coupées, URL du site, TOTP ; 25 migrations de `main` + communes appliquées et vérifiées. Restent : migrations suivantes, premier admin, Turnstile, SMTP, branchement Vercel Production.
- [ ] `SIGNUPS_OPEN=true` sur Vercel Production (aujourd'hui `false` : « Inscriptions bientôt ouvertes » ; `true` en Preview et en local).
- [ ] Interdire aussi les inscriptions directes par l'API Auth tant que la production n'est pas prête : `SIGNUPS_OPEN` ne protège que le site (Supabase Auth → « Allow new users to sign up » sur la future base de production).
- [x] Relecture des contenus `docs/content/` et de la liste de départ des mots-clés (chargée).
- [ ] Remplir la catégorie `harassment` depuis l'admin (Phase 7).
- [ ] **Notifications de la prod : leurs propres clés, jamais celles de la preview** (décision du porteur, 2026-10-18). Au lancement seulement : nouvelle paire VAPID et nouveau secret de route pour la Production Vercel (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_CRON_SECRET`), et dans le coffre de `bad-boys-prod` : `push_cron_secret` (même valeur que `PUSH_CRON_SECRET` de Production) et `push_endpoint_url` = `https://<domaine de production>/api/cron/push`, sans `vercel_protection_bypass`. Rien n'est posé d'ici là (coffre de prod et variables Vercel non touchés).
- [ ] **Test sur vrais téléphones** (Android et iPhone, Web Push réel de bout en bout : abonnement, notification écran verrouillé, texte neutre, ouverture du bon écran, désactivation) — sorti de la Phase 5a par décision du porteur (2026-10-07).
- [ ] Créer le compte super admin et lancer `supabase/scripts/grant_super_admin.sql` sur la base de production.
- [ ] **Base de production : aucun connecteur d'IA avec droits d'écriture** (ils tournent en `postgres` et contourneraient la protection du super admin), ou connecteur retiré après la mise en place (décision du porteur, 2026-10-07).
- [ ] **Vérifier la limite de connexions temps réel de l'offre gratuite Supabase** (Realtime) ; repli par lecture toutes les 3 s en place (décision du porteur, 2026-10-18).
- [ ] **Poser les clés Turnstile sur Vercel** (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, absente aujourd'hui ; la clé secrète va dans Supabase Auth → Captcha).

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

## Décisions à valider (revue du porteur en fin de phase)

Phase 6 — réponses du conseiller du 2026-10-19 (**6-1 à 6-14 validées par le conseiller le 2026-10-19**) :

| # | Question | Choix retenu | Alternative écartée |
|---|---|---|---|
| 6-1 | Quand lever le masquage des coordonnées ? | Seulement quand une Cavale est acceptée, comptes de plus de 7 jours, aucun signalement bloquant ouvert (SPEC §10 et SCHEMA mis à jour) | La voie « 10 messages chacun » (retirée : un arnaqueur l'atteint sans effort) |
| 6-2 | Quels messages sont en clair ? | Seulement ceux envoyés après la levée | Démasquer aussi les anciens |
| 6-3 | Vie d'une Cavale acceptée | Annulation par l'un ou l'autre, en un geste, sans justification ; déplacer = annuler puis reproposer ; la carte disparaît le lendemain de la date ; nouvelle Cavale possible ensuite ; le masquage reste levé même si la Cavale est annulée | Modifier une Cavale acceptée ; carte permanente |
| 6-4 | « Pas encore » | 24 h d'attente pour celui qui a proposé, aucune pour l'autre | Aucune attente ; attente pour les deux |
| 6-5 | Indicateur « Lu » | Seulement sous mon dernier message lu par l'autre, sans option au lancement | « Lu » sous chaque message ; option pour le désactiver |
| 6-6 | « Compte supprimé » dans la conversation | Phase 7 (avec la suppression réelle des comptes) | Phase 6 |

Phase 6 — choix pris en cours de phase (option la plus prudente de la SPEC) :

| # | Question | Choix retenu | Alternative écartée |
|---|---|---|---|
| 6-7 | Délai d'une Cavale | De 1 h à 60 jours à l'avance, heure au quart d'heure dans le formulaire | Sans limite ; au moins 24 h |
| 6-8 | « Le lendemain de la date » : quel fuseau ? | Heure de France (`Europe/Paris`), pour les deux | Fuseau de chacun |
| 6-9 | Nom du lieu | Toujours masqué (coordonnées) et passé aux mots-clés, même après la levée | En clair après la levée |
| 6-10 | « Pas encore » prévient-il ? | Aucune notification, le proposant le voit dans la conversation | Une notification neutre |
| 6-11 | Nouvelle proposition pendant une Cavale acceptée à venir | Refusée : déplacer = annuler puis reproposer | Deux Cavales à la fois |
| 6-12 | Signalement bloquant ouvert après la levée | Le masquage revient tant qu'il est ouvert | Levée définitive quoi qu'il arrive |
| 6-13 | Non-lus pendant la visite de 30 min | Comptés seulement dans les Parloirs sans horaire (« Lu » marche aussi pendant la visite) | Compter aussi pendant la visite |
| 6-14 | Retirer sa propre proposition en attente | Possible (le proposant seulement) | Impossible |

Phase 7 — choix pris en cours de phase (option la plus prudente de la SPEC) :

| # | Question | Choix retenu | Alternative écartée |
|---|---|---|---|
| 7-1 | Effet d'une suspension, d'un bannissement ou d'une Fiche masquée sur les affaires en cours | Toutes les affaires ouvertes du membre sont classées (demandes, visites, Parloirs, Cavales) ; l'autre reçoit le message neutre « Affaire classée » (Visiteur) ou « visite annulée » (Bad) | Laisser les affaires ouvertes pendant une suspension |
| 7-2 | Qui lève un bannissement ? | Le super admin seulement, motif obligatoire | Tout admin |
| 7-3 | Qui peut être sanctionné ? | Jamais soi-même ; un admin seulement par le super admin ; le super admin par personne (il n'a pas de profil) | Un admin sanctionne un autre admin |
| 7-4 | Exposé des motifs | Deux motifs distincts : un pour le signaleur (il voit l'issue, jamais la sanction de l'autre), un pour la personne concernée (jamais l'identité du signaleur) ; 10 à 1 000 caractères | Un seul motif partagé |
| 7-5 | Signalement retenu | Une sanction est obligatoire (au moins un avertissement) et Bonne conduite est retirée ; une suspension, un bannissement ou une Fiche masquée la retirent aussi | Retenir sans sanction |
| 7-6 | Masquage automatique « mineur » | Levé quand tous les signalements « mineur » du membre sont rejetés ; il reste tant qu'un seul est ouvert ou retenu | Levée manuelle seulement |
| 7-7 | Textes signalés | « Rien à signaler » (personne n'est prévenu), « Retenir » (puis sanction depuis la fiche du membre), « Retirer le texte » pour la note comportementale, la précision d'un signe, le mot d'une demande (et sa copie au Parloir) et un message ; le pseudo, le Motif de visite, le Casier et le lieu d'une Cavale ne sont jamais réécrits par le Greffe | Réécrire ces textes à la place du membre |
| 7-8 | Ce que voit un membre sanctionné | À la place du site : la sanction, sa fin et le motif ; une Fiche en vérification (« mineur ») le dit, sans motif | Un bandeau avec le site utilisable |
| 7-9 | Recherche d'un membre | Début du pseudo ou e-mail exact ; l'e-mail n'est jamais affiché ; jamais par le N° d'écrou (règle de la Phase 4) | Recherche par N° d'écrou |
| 7-10 | Motifs d'un banni | Il ne peut plus se connecter : l'exposé des motifs part aussi par e-mail (file `email_outbox`, envoi en 7e) | Notification dans le site seulement |
| 7-11 | Durée d'une suspension | 1 à 90 jours ; une nouvelle suspension ne raccourcit jamais celle en cours | Durée libre |
| 7-12 | Web Push pour les décisions | Aucun (notification dans le site, e-mail pour un bannissement) | Push neutre vers Ma Fiche |

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
| `pnpm exec supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,postgres-meta` | pile Supabase locale (Docker) avec communes 83/06 et quartiers |
| `node scripts/ci/local-env.mjs .env.ci.local` puis `set -a; . ./.env.ci.local; set +a` | environnement local (secrets générés) ; ensuite `pnpm build` et `E2E_DEVICES=true pnpm exec playwright test --project=pixel-7 --project=iphone-14` |
| `pnpm exec supabase test db` | pgTAP complet sur la pile locale |

Chromium : Playwright et Lighthouse utilisent `/opt/pw-browsers/chromium` par défaut ; sur une autre machine, définir `PLAYWRIGHT_CHROMIUM_PATH` et `CHROME_PATH`.
