# CLAUDE.md — Bad Boys & Bad Girls

Site de rencontre pour les profils « bad » : tatoué·es, motards, noctambules, rebelles, francs du collier.
Promesse de marque : **« Bad, pas toxique. »** Signature : **« Coupables de charme… »**
Pour qui : **« Pour ceux qu'on a toujours trouvés trop. »** Principe : **« Ici, c'est toi le juge. »**

Ce fichier contient les règles permanentes. La spécification détaillée est dans `docs/SPEC.md` : relis les sections concernées avant chaque phase.
Le plan de travail par phases est dans `docs/PROMPT.md`. L'état d'avancement est dans `docs/PROGRESS.md`.

## Règles de travail (obligatoires)

1. **Travaille par phases.** À la fin de chaque phase : résumé de ce qui est fait, ce qui reste, les écarts par rapport à la spec, puis **ARRÊTE-TOI et attends ma validation**. Ne commence jamais la phase suivante seul.
2. **Tiens `docs/PROGRESS.md` à jour** à chaque étape significative : phase en cours, tâches faites/restantes, décisions prises (avec leur raison), questions ouvertes, commandes utiles. Au début de chaque session, **lis-le en premier** pour reprendre où tu t'étais arrêté.
3. **Pose tes questions au lieu de deviner** quand la spec est ambiguë ou contradictoire. Liste-les en fin de phase.
4. **Ne jamais inventer** de contenu public : pas de faux membres, faux témoignages, fausses statistiques ou faux avis. Les textes manquants deviennent `[À COMPLÉTER : …]`. Seule exception : le seed de développement (SPEC §19), jamais en production.
5. **Zéro coût** : uniquement des services en offre gratuite (voir Stack). Si une fonctionnalité exige un service payant, signale-le et propose l'alternative gratuite ; n'ajoute rien de payant.
6. **Sécurité avant fonctionnalité** : chaque table a sa RLS et ses tests pgTAP avant d'être utilisée par l'UI.
7. **Définition de « terminé »** pour toute tâche : `pnpm typecheck`, `pnpm lint`, `pnpm test` et `pnpm build` passent sans erreur.
8. **Si une phase est trop grosse**, découpe-la en sous-étapes et annonce le découpage avant de commencer.
9. **Ne jamais affaiblir une règle de sécurité ou de vie privée** pour faire passer un test ou une fonctionnalité : arrête-toi et demande.
10. Commits petits et atomiques, messages en anglais au format Conventional Commits.

## Stack (imposée)

- **pnpm** comme gestionnaire de paquets. Versions exactes figées dans `package.json` et notées dans `PROGRESS.md` en Phase 0.
- **Next.js** (App Router, dernière version stable), **TypeScript strict**, **React Server Components** par défaut, `"use client"` seulement si nécessaire.
- **Tailwind CSS** + composants maison (pas de gros kit UI). Icônes : `lucide-react` (import nominatif).
- **Supabase** (offre gratuite) : Auth, Postgres, Row Level Security, Realtime, Storage.
- **Vercel** (plan Hobby) : hébergement + 1 cron quotidien.
- **next-intl** : français par défaut, anglais préparé (toutes les chaînes UI dans `messages/fr.json` et `messages/en.json`, aucune chaîne en dur).
- **Zod** : validation de toutes les entrées côté serveur (Server Actions et Route Handlers).
- **Cloudflare Turnstile** (gratuit) : anti-bot à l'inscription et à la connexion.
- **SMTP** : Brevo ou Resend en offre gratuite branché sur Supabase Auth (le SMTP par défaut de Supabase est trop limité pour la production).
- Tests : **Vitest** (logique), **pgTAP** via `supabase test db` (RLS et fonctions SQL), **Playwright** (parcours critiques).
- Types de la base générés avec `supabase gen types` (jamais écrits à la main).
- Dev local : Supabase CLI en local si Docker est disponible, sinon un projet Supabase de développement séparé de la production.
- Tâches planifiées : `pg_cron` dans Supabase si disponible sur l'offre gratuite, sinon cron Vercel quotidien (vérifier en Phase 0).

## Conventions de code

- Identifiants, noms de fichiers, commentaires : anglais. UI : français via i18n.
- Arborescence : `app/[locale]/…`, `components/`, `lib/` (logique pure testable), `lib/supabase/` (clients server/browser), `supabase/migrations/` (SQL versionné), `messages/`, `docs/`.
- Toute la logique métier sensible (limites, score, permissions) vit **dans Postgres** (fonctions SQL `security definer` + RLS), jamais seulement côté client.
- La clé `service_role` n'est utilisée que côté serveur, dans `lib/supabase/admin.ts`, et jamais importée par un composant client.
- Pas de `any`. Pas de `dangerouslySetInnerHTML`.

## Vocabulaire du produit (à respecter dans le code et l'UI)

| Concept | Nom produit | Nom technique |
|---|---|---|
| Profil | La Fiche | `profile` |
| 3 affirmations dont 1 fausse | Le Casier | `casier_charges` |
| Démarche pour aborder quelqu'un | La Plaidoirie | `plea` |
| Accepter une plaidoirie | Libérer | `plea.status = 'accepted'` |
| Refuser / terminer | Affaire classée | `status = 'dismissed'` |
| Messagerie | Le Parloir | `conversation`, `message` |
| Score QCM | Indice de complicité | `complicity_score` |
| Aide à l'écriture | Le Souffleur | `lib/prompter` |
| Badge de confiance | Réglo | `profile.is_reglo` |
| Plafond de plaidoiries atteint | Parloir complet | `profile.pleas_open = false` |
| Sélection quotidienne de 5 Fiches à 21 h | L'Audience du soir | `daily_hearings` |
| Plaidoiries reçues | Le Juge, c'est toi | `pleas` (côté destinataire) |
| Plaidoiries mutuelles | Coupables tous les deux | libération automatique |
| Proposition de rendez-vous à deux | La Cavale | `date_proposals` |
| Sorties de groupe (V2) | La Virée | hors MVP |
| Ville pas encore ouverte | Ta ville ouvre bientôt | `launch_zones.status = 'waitlist'` |
| Tribus / centres d'intérêt | Signes distinctifs | `tribes` |

Termes **interdits** dans l'UI : « match », « swipe », « like ». Aucun insigne ni nom d'administration réelle (police, gendarmerie, justice).

## Identité visuelle

- Palette : noir `#0E0E10` (fond), or `#D4A437` (bad boys), rouge `#E0233F` (bad girls), crème `#F2E8D5` (texte), gris `#9A9186` (texte secondaire, vérifier le contraste AA).
- Polices (via `next/font/google`, auto-hébergées) : **Anton** (titres), **Inter Tight** (texte), **Special Elite** (tampons, Casier), **Yellowtail** (signature, usage rare).
- Thème sombre par défaut. Mobile-first. Contraste WCAG AA obligatoire.
- Logo : `public/brand/logo-3d.png` (visuel fourni, pour la home et l'image Open Graph). Crée en plus un **logo SVG plat** (monogramme : B miroir or couronné + B rouge avec cornes et queue de diable) pour le header, le favicon et l'icône PWA.
- Éléments signature : fond « toise » sur la photo principale de la Fiche, tampons animés « COUPABLE » / « LIBÉRÉ·E » / « AFFAIRE CLASSÉE ».
