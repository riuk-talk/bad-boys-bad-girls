# Bad Boys & Bad Girls

Site de rencontre « Bad, pas toxique. » Coupables de charme…

- `CLAUDE.md` : règles permanentes du projet (stack, vocabulaire, sécurité).
- `docs/SPEC.md` : spécification complète ; `docs/SCHEMA.md` : schéma de la base.
- `docs/PROGRESS.md` : état d'avancement, décisions, **checklist avant lancement**, liste des risques.
- `docs/PROMPT.md` : plan de travail par phases.

## Stack

Next.js 16 (App Router, TypeScript strict, React Server Components), Tailwind CSS, next-intl (français, anglais préparé), Zod, Supabase (Auth, Postgres + RLS, Realtime, Storage, pg_cron, pg_net, Vault), Vercel (plan Hobby), Web Push (VAPID), Brevo (e-mails), Cloudflare Turnstile. Tests : Vitest, pgTAP (`supabase test db`), Playwright. Versions exactes figées dans `package.json` ; Node ≥ 20.9, pnpm 10.28.

## Installation (développement local)

Prérequis : Node, pnpm, Docker (pour la pile Supabase locale).

```bash
pnpm install
pnpm exec supabase start          # pile locale : Postgres, Auth, Storage, Realtime, Mailpit
pnpm exec supabase db reset       # applique toutes les migrations de supabase/migrations
node scripts/ci/local-env.mjs .env.local   # variables de la pile locale, secrets aléatoires
pnpm dev
```

`scripts/ci/local-env.mjs` génère des secrets aléatoires propres à la machine ; ne jamais réutiliser ces valeurs ailleurs. Sans Docker : un projet Supabase de développement séparé de la production (variables à recopier depuis `.env.example`).

Commandes de vérification (définition de « terminé ») :

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm exec supabase test db        # tests RLS et fonctions SQL (pgTAP)
pnpm test:e2e                     # Playwright (parcours complet sur la pile locale)
```

Mesures : `pnpm lighthouse <url> [chemins…]` (pages publiques), `E2E_LIGHTHOUSE=true` sur `tests/e2e/journey.spec.ts` (pages membres), `node scripts/perf/realtime-load.mjs [visites] [secondes]` (charge Realtime, pile locale), `supabase/scripts/perf/explain-discover.sql` (plan de `discover_bads`).

## Variables d'environnement

Modèle complet : `.env.example`. Sur Vercel, chaque environnement (Preview, Production) a **ses propres valeurs** ; les clés de la preview ne vont jamais en production.

| Variable | Côté | Rôle |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | public | URL canonique (liens des e-mails, Open Graph) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Supabase (la RLS s'applique) |
| `SUPABASE_SECRET_KEY` | **serveur** | clé secrète, lue uniquement par `lib/supabase/admin.ts` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | public | anti-bot ; la clé secrète Turnstile va dans Supabase Auth → Captcha |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | public / **serveur** / serveur | Web Push (`npx web-push generate-vapid-keys`) ; la clé privée en type « sensitive » |
| `PUSH_CRON_SECRET` | **serveur** | secret des routes `/api/cron/push`, `/api/cron/email`, `/api/cron/cleanup` (32 caractères au moins) ; la même valeur dans le coffre Supabase (`push_cron_secret`) |
| `BREVO_API_KEY`, `EMAIL_FROM` | **serveur** | e-mails de l'application (API Brevo) ; le SMTP des e-mails d'Auth se règle dans Supabase Auth → SMTP |
| `APP_ENV` | serveur | `development`, `preview` ou `production` (`production` masque `/design`) |
| `SIGNUPS_OPEN` | serveur | `true` pour ouvrir les inscriptions sur le site ; toute autre valeur les ferme |
| `ALLOW_DEV_SEED` | serveur | garde du seed de développement, jamais en production |

Coffre Supabase (Vault) : `push_endpoint_url` (`https://<domaine>/api/cron/push`), `push_cron_secret` et, sur la preview seulement, `vercel_protection_bypass`. La base refuse tout autre nom (la clé privée VAPID n'y entre jamais). Le poivre `ban_email_pepper` est créé par la migration, dans la base, jamais affiché.

## Déploiement

- **Deux projets Supabase** : `bad-boys-preview` (phases en cours, previews Vercel) et `bad-boys-prod` (uniquement les migrations de `main`, texte exact des fichiers).
- **Migrations** : appliquées dans l'ordre de `supabase/migrations`, sans modification. Une migration qui contient une opération destructive est lancée par le porteur (SQL Editor ou `psql`, jamais par un connecteur d'IA). Après chaque migration : comparer le MD5 du texte enregistré dans `supabase_migrations.schema_migrations` au fichier. Le SQL Editor ré-indente parfois le texte : préférer `psql -f`.
- **Types** : `supabase gen types` depuis la base de la preview (jamais écrits à la main).
- **Vercel** : déploiement automatique des branches (Preview) et de `main` (Production). Aucun cron Vercel : les tâches planifiées tournent dans Supabase (`pg_cron`) et appellent les routes du site par `pg_net` avec le secret, seulement quand il y a quelque chose à faire.
- **Tâches planifiées** (`pg_cron`, heure de Paris pour les quotidiennes) : distribution des notifications (chaque minute) et des e-mails (toutes les 10 min), Heures de visite et Parloir (chaque minute), Promenade de 21 h, expiration des demandes, Bonne conduite, Fiches en veille, ouverture automatique des quartiers, nettoyage (lignes anciennes, photos, comptes inachevés, mesures de performance de plus de 90 jours).

## Premier administrateur et super admin

1. Créer le compte sur le site (e-mail confirmé). Pour le super admin : **ne pas** faire l'onboarding (un super admin n'a pas de profil).
2. Dans le SQL Editor de la base concernée, en tant que propriétaire :
   - administrateur : `supabase/scripts/create_first_admin.sql` (remplacer l'e-mail) ;
   - super admin : `supabase/scripts/grant_super_admin.sql` (remplacer l'identifiant du compte).
3. Se connecter : `/admin` demande la double authentification (TOTP) avant tout accès.

Aucun rôle d'administration sur les comptes de test d'une base partagée. Sur la production, aucun connecteur d'IA avec droits d'écriture (il tournerait en propriétaire et contournerait la protection du super admin).

## Ouvrir un quartier

`/admin/quartiers` : chaque quartier = une ville, un rayon, un fuseau, des seuils (nombre de Bads comptés, planchers femmes / hommes) et l'option d'ouverture automatique. La jauge suit les Bads comptés (onboarding fini, 3 poses validées, actifs dans les 30 jours, ni en pause, ni masqués). L'admin ouvre le quartier, ou la tâche quotidienne l'ouvre quand l'option est cochée et les seuils atteints ; les membres du quartier sont prévenus. Le mode global (`/admin/quartiers`, super admin) peut aussi ouvrir tout le site d'un coup.

## Limites des offres gratuites

Vérifiées le 2026-10-20 ; **à revérifier au moment du lancement**.

- **Vercel Hobby** : usage **non commercial** uniquement ; passer en Pro avant toute monétisation.
- **Supabase Free** : base, stockage et bande passante limités ; **Realtime : 200 connexions simultanées, 100 messages/s, 100 connexions de canal/s** (soit 100 visites au Parloir en même temps) ; au-delà, le Parloir passe sur un relevé toutes les 3 s. Un projet gratuit inactif se met en pause au bout de 7 jours. La protection contre les mots de passe divulgués est réservée au plan Pro (le minimum de 12 caractères reste réglable : Auth → Email).
- **Brevo gratuit** : quota quotidien d'e-mails ; l'application garde une réserve pour les e-mails d'Auth et reporte le reste au lendemain. Il faut un domaine authentifié (SPF, DKIM, DMARC) : un expéditeur d'une messagerie grand public est refusé ou classé en spam.
- **Web Push** : gratuit, sans quota de notre côté ; dépend des services de push des navigateurs.

## Checklist avant ouverture des inscriptions

La liste à jour, cochée au fil de l'eau, est dans `docs/PROGRESS.md` (section « Checklist avant lancement »). En résumé : migrations de la prod à jour et vérifiées, premier admin et super admin, Turnstile (site et Supabase Auth), nom de domaine puis domaine authentifié chez Brevo puis `BREVO_API_KEY` et `EMAIL_FROM` en Production, clés de notification propres à la prod, minimum de 12 caractères dans Supabase Auth, test sur vrais téléphones (Web Push, lecteur d'écran), vérification juridique de la conservation des données d'identification, retrait des droits d'écriture du connecteur d'IA sur la prod, `SIGNUPS_OPEN=true` en Production en dernier.
