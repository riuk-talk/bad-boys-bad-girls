# PROMPT — à coller dans Claude Code (v7)

> **Avant de lancer** : crée un dossier vide et places-y `CLAUDE.md` à la racine, `docs/SPEC.md`, `docs/PROMPT.md` et le logo dans `public/brand/logo-3d.png`. Ouvre Claude Code dans ce dossier et colle le bloc ci-dessous.
>
> **Pour reprendre après une coupure** (nouvelle session, contexte plein) : colle simplement « Lis CLAUDE.md puis docs/PROGRESS.md et reprends où tu t'es arrêté. »

---

Tu es le développeur principal de **Bad Boys & Bad Girls**, un site de rencontre pour profils « bad ». Tu construis un produit de production : rapide, sûr, conforme au RGPD, avec un design moderne et soigné qui ne ressemble à aucun autre site de rencontre.

Lis entièrement `CLAUDE.md` puis `docs/SPEC.md`. Ils font foi. Ce fichier définit l'ordre de travail.

Tu construis d'abord tout le **P0** (Phases 0 à 8). Les éléments marqués **[P1]** dans la spec attendent la Phase 9.

> **Plan v7 (2026-10-03)** : le concept v2 (`docs/CONCEPT-V2.md`, SPEC v7) a remplacé la Plaidoirie par la Demande de parloir et les Heures de visite. Les Phases 0, 1 et 2 sont livrées ; la **Phase 2b** met le code livré à niveau avant la Phase 3. Les phases 3 à 9 ci-dessous remplacent l'ancien plan.

Tu travailles **phase par phase**. À la fin de chaque phase :
1. Vérifie toi-même les critères d'acceptation et la définition de « terminé » (typecheck, lint, tests, build).
2. Mets à jour `docs/PROGRESS.md`.
3. Donne-moi : ce qui est fait, comment le tester en local (étapes concrètes), les écarts par rapport à la spec, tes questions.
4. **Arrête-toi et attends ma validation écrite** avant de passer à la phase suivante.
5. Phase validée → pull request vers `main`.

## Phase 0 — Cadrage (aucun code applicatif) — ✅ livrée
- Relis la spec et liste les ambiguïtés, contradictions et risques que tu y vois, classés par gravité.
- Vérifie (documentation officielle) les points marqués « vérifier ».
- Propose : l'arborescence, le schéma de base complet, la liste des variables d'environnement.
- Liste ce que je dois créer moi-même avec les étapes. Crée `docs/PROGRESS.md`.

## Phase 1 — Fondations et identité — ✅ livrée
- Next.js + TypeScript strict + Tailwind + ESLint/Prettier + next-intl (fr/en) + Vitest + Playwright + Supabase CLI ; design system ; logo, icônes PWA, manifest, Open Graph ; landing, pages d'authentification (UI), pages légales, Charte, Conseils sécurité, 404/500 ; en-têtes de sécurité, `robots.txt`, `noindex`.

## Phase 2 — Comptes, onboarding, Fiche, photos, zones — ✅ livrée
- Migrations (profils, consentements, admin, tribus, photos, communes, zones, parrainage) avec RLS et pgTAP ; auth Supabase + Turnstile + 18+ en base ; onboarding étapes 1 à 4 ; photos sans EXIF ; Ma Fiche ; « Ta ville ouvre bientôt » ; premier admin ; seed.

## Phase 2b — Mise à niveau concept v2 (code livré)
- Migration SQL (SCHEMA §6) : `role`, `role_changed_at`, `visit_motive`, renommages `pleas_*` → `requests_*`, `false_index` → `true_index`, seuils de quartier en Bads (`threshold_bads`, plancher bad girls / bad boys), `zone_progress()` v2, `complete_onboarding()` selon le rôle, `set_onboarding_role()`, enums (`email_kind`, `flag_source`), `notification_preferences`, `btree_gist`. Types régénérés, pgTAP Phase 2 adaptés.
- Landing : **deux portes** « Je suis Bad » / « Je viens visiter », déroulé par rôle, textes sans « plaider ».
- Inscription : rôle transmis par la porte (`?role=`) et enregistré avec le compte.
- Onboarding : étape **« Ton rôle »** (3), « Qui tu viens voir » pour le Visiteur, étape **Motif de visite** (Visiteur) ; numérotation 1–7 ; reprise.
- « Ton quartier ouvre bientôt » : trois jauges (Bads, bad girls, bad boys), Visiteurs en attente (vu par les Bads), liste d'attente des Visiteurs.
- Ma Fiche / Mon Permis : aperçu selon le rôle (Permis : une seule photo, Motif, badges).
- Lexique v7 dans `messages/*.json`, la Charte, les CGU, la confidentialité (Web Push), les tampons (« BONNE CONDUITE », « PERMIS DÉLIVRÉ », « VISITE ACCEPTÉE ») ; test du vocabulaire interdit étendu.
- **Critères** : un membre ne peut pas modifier son rôle directement (pgTAP) ; l'onboarding d'un Visiteur exige le Motif, celui d'un Bad ne l'exige pas ; `zone_progress` respecte les planchers et exclut pause/inactifs/seed ; e2e : les deux portes mènent au bon parcours ; plus aucune occurrence de « plaid » dans l'UI ; Lighthouse landing ≥ 90 et budget JS tenu.

## Phase 3 — QCM, indice de complicité, Casier, Greffe des photos
- Seed des 20 questions (FR + EN).
- Écran QCM (une question par écran, un tap, « Affiner » replié, progression, modifiable ensuite) ; 10 questions à l'inscription (étape 7, les deux rôles), 10 ensuite.
- `complicity_score` en SQL + `lib/complicity.ts` + tests de parité (au moins 12 cas, dont : moins de 5 questions communes, deal-breaker, compatibilité parfaite, incompatibilité totale).
- Le Casier **1 vrai, 2 faux** (Bad, étape 6) : assistant (banque de 60 amorces FR + EN, le vrai d'abord puis deux faux crédibles, « Autre idée », écriture libre, aperçu mélangé), choix du vrai, filtre mots-clés.
- **Le Greffe, minimum vital** (validé) : file admin des photos (priorité SPEC §11), valider/refuser avec motif, copie vers le bucket public, suppression du fichier en attente, tampon « PERMIS DÉLIVRÉ » et notification in-app. (Le reste de `/admin` reste en Phase 7.) Raison : sans photo validée, personne n'est visible et aucun Visiteur ne peut demander de visite ; les Phases 4 à 6 en dépendent.
- **Critères** : scores SQL et TS identiques ; < 5 questions communes = pas d'indice ; Casier impossible pour un Visiteur (pgTAP) ; une photo validée est servie publiquement sans EXIF et le fichier en attente est supprimé ; un non-admin ne peut appeler aucune fonction du Greffe.

## Phase 4 — Promenade, Découverte, Fiche et Permis, Demande de parloir, Le Courrier
- Tâches planifiées (`pg_cron`) : `run_promenades_due`, `expire_visit_requests`.
- `build_daily_promenade` (SPEC §12, Visiteurs uniquement, répartition de l'attention, `visible_from`) + écran « La Promenade » (5 Bads, compte à rebours, états vides honnêtes).
- `discover_bads` + page Découverte (Visiteurs uniquement).
- Fiche publique du Bad (toise, Casier sans le vrai, complicité, 3 points communs, Bonne conduite, « Parloir complet ») ; Permis vu par un Bad (`get_permit`, Casier vierge, Visites honorées).
- Modale **Demande de parloir** + `send_visit_request` (toutes les limites SPEC §7, plafond, anti-arnaque) ; écran « Demande déposée » sans révélation.
- Le Souffleur (`lib/prompter`, accroches qui ne citent jamais le chef choisi, modèles FR/EN, tests) ; avertissement « Ton pari reste secret jusqu'à la visite. »
- « Le Courrier » : Permis, indice, 3 points communs, mot — **ni chef choisi ni résultat du pari** (règle 14) ; **Accepter** (sans créneaux à ce stade : la proposition de créneaux arrive en Phase 5, la demande reste `accepted`) / **Affaire classée** ; réglage du plafond ; conseils au Visiteur après 3 classements.
- « Mes demandes » (Visiteur).
- Changement de rôle (`change_role`, 7 jours, effets SPEC §2 bis) ; mise en pause de la Fiche ; blocage et signalement depuis une Fiche ou un Permis.
- **Critères** : un Bad au-dessus de 50 % de son plafond sort moins souvent en Promenade (test sur le seed) ; un Bad ne peut pas demander de visite ; la 6e demande en 24 h est refusée par la base ; redemander avant 30 jours est impossible ; au plafond → « Parloir complet » ; deux Visiteurs ne se voient jamais, deux Bads non plus ; un profil bloqué n'apparaît nulle part (pgTAP) ; `EXPLAIN ANALYZE` de `discover_bads` sur 1 000 Bads de seed < 200 ms ; génération de la Promenade pour 5 000 Visiteurs < 5 min.

## Phase 5 — Heures de visite, Web Push, visite au Parloir
Découpage imposé : **5a Web Push** · **5b Heures de visite** · **5c La visite**. **Arrêt après chaque sous-phase** : validation écrite et test sur téléphone avant la suivante.
- **5a** : clés VAPID (variables d'environnement, clé privée côté serveur uniquement), service worker (`worker-src 'self'`, jamais chargé sur la landing), `push_subscriptions`, demande d'abonnement au bon moment, guide d'installation iPhone, `push_outbox` + route `/api/cron/push` (envoi, suppression des abonnements expirés), préférences par type, contenu neutre.
- **5b** : proposition de 2–3 créneaux avec raccourcis (« Ce soir », « Demain soir », « Ce week-end »), choix du créneau (48 h), « Aucun ne me va » (1 fois), annulation (tardive < 2 h), agenda « Mes visites » pour les deux rôles, tâche minute `run_visit_ticks` (rappels H-1 et à l'heure, délais échus).
- **5c** : écran de visite (compte à rebours, écran d'attente, présence `join_visit`), message système « résultat du pari », messages en temps réel limités au créneau (repli par interrogation), absence à +10 min et report, deuxième absence → classement, choix de fin « Prolonger » / « Affaire classée » (24 h), Permis permanent ; Signaler/Bloquer pendant la visite.
- **Critères** : deux visites qui se chevauchent sont refusées par la base ; aucun message hors du créneau avant le Permis permanent ; ni le Bad ni le Visiteur ne voient le chef choisi ou le résultat du pari avant le début de la visite (règle 14, pgTAP) ; un rappel n'est jamais envoyé deux fois ; absence et Permis permanent correctes avec horloge simulée (pgTAP) ; e2e complet de deux navigateurs : demande → acceptation → créneau → visite → Permis permanent ; aucune notification ne contient de pseudo ni de texte ; aucun service worker ni connexion temps réel hors des écrans concernés.

## Phase 6 — Le Parloir sans horaire (Permis permanent) et la Cavale
- Conversation au Parloir sans horaire (Permis permanent) : messages, temps réel avec repli, lu/non lu, compteurs, anti-spam, champ toujours visible.
- La Cavale : proposition, acceptation / contre-proposition / « pas encore », carte épinglée, avertissement lieu privé.
- « Classer l'affaire », Signaler/Bloquer, encart sécurité.
- Masquage des coordonnées, levé après une Cavale acceptée ou 10 messages chacun (SPEC §10), jamais pendant une visite.
- **Critères** : un tiers ne peut ni lire ni s'abonner à une conversation qui n'est pas la sienne ; après un blocage, plus aucun message ne passe ; aucune connexion temps réel hors d'une conversation affichée.

## Phase 7 — Modération, pilotage, tâches planifiées, RGPD, notifications e-mail
- `/admin` complet (SPEC §15) : signalements, textes signalés, sanctions, quartiers et seuils, tribus, mots-clés, questions, **tableau de santé** (métriques v7).
- Exposé des motifs au signaleur et à la personne sanctionnée.
- Tâches : Bonne conduite, Fiches inactives (21 et 90 jours), ouverture auto des quartiers (`ready_at`, e-mail admin), nettoyage.
- Export JSON et suppression réelle du compte (abonnements push et visites compris) ; empreinte e-mail des bannis.
- E-mails (Brevo) avec préférences, regroupement quotidien, report quand le quota est atteint, rappels de visite sur option.
- **Critères** : la suppression d'un compte efface la base **et** les fichiers ; l'export contient toutes les données de l'utilisateur et rien d'autre ; un banni ne peut pas se réinscrire avec le même e-mail.

## Phase 8 — Audit final
- Sécurité : relecture de toutes les politiques RLS, recherche de fuites de la clé secrète et de la clé privée VAPID, tests d'autorisation négatifs, `supabase db lint`.
- Performance : Lighthouse sur la landing, la Promenade, la Découverte, une Fiche, « Le Courrier » et le Parloir ; Core Web Vitals réels ; charge Realtime d'un soir à 21 h (100 visites simultanées).
- Accessibilité : clavier, lecteur d'écran, contrastes, `reduced-motion`, compte à rebours accessible.
- Playwright : inscription Bad et Visiteur → onboarding → demande → acceptation → créneau → visite → Permis permanent → message → Cavale acceptée → blocage → suppression de compte.
- README : installation, variables d'environnement (VAPID comprises), déploiement, premier admin, ouverture d'un quartier, limites des offres gratuites, checklist avant ouverture.
- **Critère** : liste des risques restants, classés par gravité, avec une recommandation pour chacun.

## Phase 9 — Éléments [P1] (seulement après ma validation de la Phase 8)
- Je choisis la liste parmi les éléments [P1] de la spec, selon les premiers retours des membres. Même règle : critères, tests, arrêt en fin de phase.

Reprends à la première phase non livrée indiquée dans `docs/PROGRESS.md`.
