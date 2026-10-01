# PROGRESS — Bad Boys & Bad Girls

> À lire en premier à chaque session. Mis à jour à chaque étape significative.

## Phase en cours

**Phase 0 — Cadrage : terminée, en attente de validation du porteur du projet.**
Aucune ligne de code applicatif écrite.

## Phase 0 — fait

- [x] Lecture complète de `CLAUDE.md`, `docs/SPEC.md`, `docs/PROMPT.md`.
- [x] Vérifications dans la documentation officielle (2026-10-01) : Next.js, `pg_cron`, quotas Supabase / Vercel / Turnstile / Resend / Brevo → `docs/PHASE0.md` §1.
- [x] Ambiguïtés, contradictions et risques classés par gravité (R1–R32) → `docs/PHASE0.md` §2.
- [x] Arborescence, variables d'environnement, tâches planifiées → `docs/PHASE0.md` §3–5.
- [x] Schéma de base complet (tables, colonnes, types, index, contraintes, RLS en clair, fonctions, triggers, tests pgTAP prévus) → `docs/SCHEMA.md`.
- [x] Liste de ce que le porteur doit créer (domaine, Supabase, Cloudflare Turnstile, Brevo, Vercel) → `docs/PHASE0.md` §6.

## Phase 0 — reste à faire

- [ ] Validation du schéma et réponses aux questions de `docs/PHASE0.md` §7.
- [ ] Confirmation que `pg_cron` et `pg_net` s'activent sur le projet Supabase de dev (doc officielle muette sur le plan Free).

## Décisions proposées (en attente de validation)

| Décision | Raison |
|---|---|
| Tâches planifiées via `pg_cron` (+ `pg_net` pour les e-mails) | Cron Vercel Hobby : 1×/jour, ±59 min — incompatible avec l'Audience multi-fuseaux et la file d'e-mails |
| Cron Vercel quotidien `/api/health` | Éviter la pause Supabase Free après 7 jours d'inactivité |
| SMTP Brevo | 300 e-mails/jour (Resend : 100), société UE |
| Clés Supabase `sb_publishable_` / `sb_secret_` | Les clés `anon` / `service_role` sont dépréciées fin 2026 |
| `proxy.ts` au lieu de `middleware.ts` | Convention Next.js 16 |
| Turnstile via l'intégration native Supabase Auth | Vérification côté Supabase, pas de code de vérification à maintenir |
| Les tiers ne lisent jamais les tables : uniquement des fonctions `security definer` | Empêche la fuite de la date de naissance, du faux du Casier et des réponses QCM |
| Empreinte des e-mails bannis en HMAC-SHA256 avec poivre secret | Un sel aléatoire rendrait la vérification à la réinscription impossible |

## Versions (à figer en Phase 1)

| Outil | Version constatée le 2026-10-01 |
|---|---|
| Next.js | 16.3.8 (npm `latest`) |
| Node.js (environnement de travail) | 22.22.0 |
| pnpm | 10.28.0 |

Les versions exactes de toutes les dépendances seront figées dans `package.json` et recopiées ici en Phase 1.

## Questions ouvertes

Voir `docs/PHASE0.md` §7 (17 questions).

## Contraintes d'environnement constatées

- Docker est installé mais le démon ne tourne pas dans l'environnement cloud de Claude Code → pas de Supabase local ici. Les tests pgTAP tourneront contre le projet Supabase de dev (ou en local chez le porteur avec Docker).

## Commandes utiles

_(à compléter en Phase 1)_
