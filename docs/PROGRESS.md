# PROGRESS — Bad Boys & Bad Girls

> À lire en premier à chaque session. Mis à jour à chaque étape significative.

## Phase en cours

**Phase 1 — Fondations et identité : en cours.**

## Phase 0 — Cadrage : ✅ validée (2026-10-01)

- Livrables : `docs/PHASE0.md` (vérifications, risques R1–R32, arborescence, env, jobs, comptes à créer), `docs/SCHEMA.md` (schéma v1 validé), `docs/PHASE0-DECISIONS.md` (réponses du porteur + corrections B1–B7).
- Décisions intégrées dans `docs/SPEC.md` (v6.1), `docs/SCHEMA.md` et `CLAUDE.md` (tableau du vocabulaire corrigé, R27).

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

## Points contradictoires ou à surveiller (relevés en appliquant les décisions)

1. **Alerte egress (décision 1)** : l'egress n'est **pas lisible en SQL**. Le stockage, oui (somme des tailles dans `storage.objects`). Pour l'egress, il faudra l'API de gestion Supabase (je ne suis pas sûr qu'un point d'accès d'usage soit ouvert sur Free : à vérifier en Phase 6) ; à défaut, saisie manuelle mensuelle dans l'admin à partir du tableau de bord Supabase.
2. **Plafond de 10 apparitions/jour** : si la répartition femmes/hommes est déséquilibrée, certains membres recevront moins de 5 Fiches (pas de remplissage, conforme à la spec). Le tableau de santé devra montrer le nombre moyen de Fiches par Audience.
3. **Garde-fou de levée du masquage (R7)** : un seul signalement ouvert contre A suspend la levée dans **toutes** les conversations de A jusqu'à décision. Vecteur d'abus possible (signalement malveillant) ; la seule parade est un délai de traitement court des signalements.
4. **Suppression des comptes sans onboarding après 30 jours** : la spec ne prévoit pas d'avertissement. Je propose de ne pas envoyer d'e-mail (quota) et d'afficher la règle sur l'écran d'onboarding. À confirmer.
5. **Hook « Before User Created »** : la doc ne confirme pas explicitement qu'il s'exécute pour une inscription par lien magique. Test à faire en Phase 2 sur le projet de dev.

## Versions figées

| Outil | Version |
|---|---|
| Node.js (environnement de travail) | 22.22.0 |
| pnpm | 10.28.0 |

_(dépendances complétées à la fin de 1a)_

## Contraintes d'environnement constatées

- Docker est installé mais le démon ne tourne pas dans l'environnement cloud de Claude Code → pas de Supabase local ici. Les tests pgTAP tourneront contre le projet Supabase de dev (ou en local chez le porteur avec Docker).
- Chromium préinstallé (`/opt/pw-browsers/chromium`), utilisé par Playwright et Lighthouse via `executablePath`.

## Questions ouvertes

- Point 4 ci-dessus (avertissement avant suppression des comptes sans onboarding).
- Nom de domaine : `[DOMAINE]` en attendant.

## Commandes utiles

_(à compléter en Phase 1)_
