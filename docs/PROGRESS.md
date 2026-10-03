# PROGRESS — Bad Boys & Bad Girls

> À lire en premier à chaque session. Mis à jour à chaque étape significative.

## Phase en cours

**Phase 2b — mise à niveau du code livré au concept v2 : terminée, en attente de validation** (branche `phase-2b-concept-v2`).
Concept v2 **validé** le 2026-10-03 (`docs/CONCEPT-V2-DECISIONS.md`), documentation intégrée sur la branche `concept-v2` (PR #6 vers `main`).

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
13. **Fin de visite sans Libération** : le choix de chacun reste secret (l'autre voit seulement « Affaire classée »).
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
