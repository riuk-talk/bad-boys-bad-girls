# PROMPT — à coller dans Claude Code (v6)

> **Avant de lancer** : crée un dossier vide et places-y `CLAUDE.md` à la racine, `docs/SPEC.md`, `docs/PROMPT.md` et le logo dans `public/brand/logo-3d.png`. Ouvre Claude Code dans ce dossier et colle le bloc ci-dessous.
>
> **Pour reprendre après une coupure** (nouvelle session, contexte plein) : colle simplement « Lis CLAUDE.md puis docs/PROGRESS.md et reprends où tu t'es arrêté. »

---

Tu es le développeur principal de **Bad Boys & Bad Girls**, un site de rencontre pour profils « bad ». Tu construis un produit de production : rapide, sûr, conforme au RGPD, avec un design moderne et soigné qui ne ressemble à aucun autre site de rencontre.

Lis entièrement `CLAUDE.md` puis `docs/SPEC.md`. Ils font foi. Ce fichier définit l'ordre de travail.

Tu construis d'abord tout le **P0** (Phases 0 à 7). Les éléments marqués **[P1]** dans la spec attendent la Phase 8.

Tu travailles **phase par phase**. À la fin de chaque phase :
1. Vérifie toi-même les critères d'acceptation et la définition de « terminé » (typecheck, lint, tests, build).
2. Mets à jour `docs/PROGRESS.md`.
3. Donne-moi : ce qui est fait, comment le tester en local (étapes concrètes), les écarts par rapport à la spec, tes questions.
4. **Arrête-toi et attends ma validation écrite** avant de passer à la phase suivante.

## Phase 0 — Cadrage (aucun code applicatif)
- Relis la spec et liste les ambiguïtés, contradictions et risques que tu y vois, classés par gravité.
- Vérifie (documentation officielle) les points marqués « vérifier » : disponibilité de `pg_cron` sur l'offre gratuite Supabase, quotas actuels Supabase/Vercel/SMTP, version stable de Next.js.
- Propose : l'arborescence, le schéma de base complet (tables, colonnes, types, index, contraintes, politiques RLS en clair, fonctions SQL), la liste des variables d'environnement.
- Liste ce que je dois créer moi-même (compte Supabase, projet Vercel, Turnstile, SMTP, nom de domaine) avec les étapes.
- Crée `docs/PROGRESS.md`.
- **Critère** : je peux valider le schéma avant toute ligne de code applicatif.

## Phase 1 — Fondations et identité
- Initialise Next.js + TypeScript strict + Tailwind + ESLint/Prettier + next-intl (fr/en) + Vitest + Playwright + Supabase CLI.
- Design system : tokens (couleurs, typo, espacements), composants de base (Button, Input, Select, Checkbox, Modal, Toast, Badge, Tampon animé avec variante `reduced-motion`, Carte Fiche, fond Toise, Squelettes, États vides).
- Logo SVG plat (monogramme) + favicon + icônes PWA + manifest ; image Open Graph à partir de `logo-3d.png`.
- Pages : landing (seule page indexée), connexion/inscription (UI), pages légales en modèle, Charte « Bad, pas toxique », Conseils sécurité, 404/500 à l'image de la marque.
- En-têtes de sécurité (CSP, etc.), `robots.txt`, `noindex` sur l'application.
- **Critères** : build OK, Lighthouse mobile ≥ 90 sur la landing, aucune chaîne en dur, rendu correct de 360 px à 1440 px, navigation clavier complète.

## Phase 2 — Comptes, onboarding, Fiche, photos, zones
- Migrations SQL : profils, consentements, admin_users, tribus, photos, places, launch_zones, parrainage, avec RLS complète et tests pgTAP.
- Auth Supabase (e-mail + mot de passe et lien magique), Turnstile, vérification 18+ en base.
- Onboarding court (SPEC §4) avec sauvegarde et reprise ; consentement art. 9 sur l'écran « Qui tu cherches ».
- Upload photos : compression WebP, suppression EXIF, bucket privé en attente, notification admin.
- « Ma Fiche » (aperçu tel que vu par les autres, statut de modération, jauge de complétude).
- Page « Ta ville ouvre bientôt » avec jauge et lien de parrainage.
- Script SQL de création du premier admin. Script de seed de développement (SPEC §19).
- **Critères** : impossible de créer un compte < 18 ans même en appelant l'API directement ; un utilisateur ne peut ni lire les données privées d'un autre ni modifier ses propres colonnes protégées (tests pgTAP) ; EXIF absent des fichiers stockés ; onboarding réalisable en moins de 5 minutes.

## Phase 3 — QCM, indice de complicité, Casier
- Seed des 20 questions (FR + EN).
- Écran QCM (une question par écran, un tap, « Affiner » replié, progression, modifiable ensuite) ; 10 questions à l'inscription, 10 ensuite.
- `complicity_score` en SQL + `lib/complicity.ts` + tests de parité (au moins 12 cas, dont : moins de 5 questions communes, deal-breaker, compatibilité parfaite, incompatibilité totale).
- Le Casier : assistant d'écriture (banque de 60 amorces à trous FR + EN, « Autre idée », écriture libre, aperçu), choix du faux, filtre mots-clés qui signale à la modération.
- **Critères** : scores SQL et TS identiques sur tous les cas ; moins de 5 questions communes = pas d'indice affiché.

## Phase 4 — Audience du soir, Découverte, Fiche publique, Plaidoirie, Souffleur
- Mise en place du mécanisme de tâches planifiées (`pg_cron` ou cron Vercel selon la Phase 0), nécessaire dès maintenant pour l'Audience.
- `build_daily_hearing` (SPEC §12 : conditions d'éligibilité, répartition de l'attention, génération à l'avance avec `visible_from`) + écran d'accueil « L'Audience du soir » (5 Fiches, compte à rebours, états vides honnêtes).
- `discover_profiles` (zone ouverte, réciprocité, filtres, blocages, pagination par curseur) + page Découverte secondaire avec état vide.
- Fiche publique (toise, Casier, complicité, 3 points communs, badges, Signaler/Bloquer, état « Parloir complet »).
- Modale Plaidoirie + `send_plea` (toutes les limites SPEC §7, dont le plafond destinataire et l'anti-arnaque) + révélation « Bien vu / Raté ».
- Le Souffleur (`lib/prompter`, modèles FR/EN, tests).
- « Le Juge, c'est toi » (plaidoiries reçues) : Libérer / Affaire classée, animations tampon, réglage du plafond ; copie du Casier enregistrée dans chaque plaidoirie ; conseils après 3 affaires classées.
- Mise en pause de la Fiche.
- Plaidoiries croisées → libération automatique mutuelle.
- **Critères** : une Fiche au-dessus de 50 % de son plafond apparaît moins souvent dans les Audiences (test sur le seed) ; deux plaidoiries croisées ouvrent le Parloir ; la 6e plaidoirie en 24 h est refusée par la base ; replaider avant 30 jours est impossible ; au plafond, la Fiche passe en « Parloir complet » ; un profil bloqué n'apparaît nulle part (tests pgTAP) ; `EXPLAIN ANALYZE` de `discover_profiles` sur 5 000 Fiches de seed < 200 ms.

## Phase 5 — Le Parloir
- Conversations, messages, temps réel avec repli, lu/non lu, compteurs, anti-spam en base ; champ de saisie toujours visible.
- La Cavale : proposition de rendez-vous, acceptation / contre-proposition / « pas encore », carte épinglée, avertissement lieu privé.
- « Classer l'affaire », Signaler/Bloquer dans la conversation, encart sécurité.
- Masquage des e-mails, téléphones et liens, levé après une Cavale acceptée ou 10 messages chacun (SPEC §10).
- Temps réel ouvert uniquement sur la conversation affichée ; compteurs par interrogation toutes les 60 s.
- **Critères** : un tiers ne peut ni lire ni s'abonner à une conversation qui n'est pas la sienne (test) ; après un blocage, plus aucun message ne passe ; aucune connexion temps réel n'est ouverte en dehors d'une conversation affichée.

## Phase 6 — Modération, pilotage, tâches planifiées, RGPD, notifications
- `/admin` complet (SPEC §15), dont le tableau de santé par zone et la gestion des zones.
- Exposé des motifs au signaleur et à la personne sanctionnée.
- Tâches planifiées complémentaires : expiration des plaidoiries à 7 jours, badge Réglo, Fiches inactives (21 et 90 jours), ouverture auto des zones (si activée), nettoyage.
- Export JSON des données et suppression réelle du compte ; empreinte e-mail des bannis.
- Notifications in-app + e-mails avec préférences, regroupement quotidien et report quand le quota est atteint.
- **Critères** : la suppression d'un compte efface la base **et** les fichiers ; l'export contient toutes les données de l'utilisateur et rien d'autre ; un banni ne peut pas se réinscrire avec le même e-mail.

## Phase 7 — Audit final
- Sécurité : relecture de toutes les politiques RLS, recherche de fuites de la clé service_role, tests d'autorisation négatifs, `supabase db lint`.
- Performance : Lighthouse sur la landing, l'Audience du soir, la Découverte, une Fiche et le Parloir ; corrige jusqu'aux seuils de la spec.
- Accessibilité : clavier, lecteur d'écran, contrastes, `reduced-motion`.
- Playwright : inscription → onboarding → plaidoirie → libération → message → Cavale acceptée → blocage → suppression de compte.
- README : installation, variables d'environnement, déploiement Vercel + Supabase, création du premier admin, ouverture d'une zone, limites des offres gratuites, checklist avant ouverture au public.
- **Critère** : liste des risques restants, classés par gravité, avec une recommandation pour chacun.

## Phase 8 — Éléments [P1] (seulement après ma validation de la Phase 7)
- Je choisis la liste parmi les éléments [P1] de la spec, selon les premiers retours des membres. Même règle : critères, tests, arrêt en fin de phase.

Commence par la **Phase 0**.
