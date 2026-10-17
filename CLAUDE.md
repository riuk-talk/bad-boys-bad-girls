# CLAUDE.md — Bad Boys & Bad Girls

Site de rencontre pour les profils « bad » : tatoué·es, motards, noctambules, rebelles, francs du collier.
Promesse de marque : **« Bad, pas toxique. »** Signature : **« Coupables de charme… »**
Pour qui : **« Pour ceux qu'on a toujours trouvés trop. »** Principe : **« Ici, rien ne se fait sans ton accord. »**

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
- Projets Supabase : **preview** `bad-boys-preview` (`chvnmzmvcjvhxlnfmlvv`, phases en cours et previews Vercel) et **production** `bad-boys-prod` (`hmmobtyherwuhrhymfbk`, uniquement les migrations de `main`, contenu exact des fichiers).
- Tâches planifiées : `pg_cron` dans Supabase si disponible sur l'offre gratuite, sinon cron Vercel quotidien (vérifier en Phase 0).

## Conventions de code

- Identifiants, noms de fichiers, commentaires : anglais. UI : français via i18n.
- Arborescence : `app/[locale]/…`, `components/`, `lib/` (logique pure testable), `lib/supabase/` (clients server/browser), `supabase/migrations/` (SQL versionné), `messages/`, `docs/`.
- Toute la logique métier sensible (limites, score, permissions) vit **dans Postgres** (fonctions SQL `security definer` + RLS), jamais seulement côté client.
- La clé `service_role` n'est utilisée que côté serveur, dans `lib/supabase/admin.ts`, et jamais importée par un composant client.
- Pas de `any`. Pas de `dangerouslySetInnerHTML`.

## Vocabulaire du produit (à respecter dans le code et l'UI)

Esprit : un site de rencontre **dans le même esprit que les prisons**, en style **cartoon et léger** (SPEC v7 §1 ter). Deux rôles : le **Bad** (reçoit des demandes de visite) et le **Visiteur** (demande des visites).

| Moment / concept | Nom dans le site | Nom technique |
|---|---|---|
| Membre qui reçoit | Le Bad | `profile.role = 'bad'` |
| Membre qui demande | Le Visiteur | `profile.role = 'visitor'` |
| Inscription Bad / Profil du Bad | Le Dossier / La Fiche | `profile` |
| Inscription Visiteur / Profil du Visiteur | Le Permis de visite | `profile` (`role = 'visitor'`) |
| Présentation du Visiteur | Le Motif de visite | `profile.visit_motive` |
| Validation des photos, modération | Le Greffe (« Permis délivré par le Greffe ») | admin |
| Les 3 phrases du Bad (1 vrai, 2 faux) | Le Casier | `casier_charges` (`true_index`) |
| Sélection du soir (5 Bads à 21 h, Visiteurs uniquement) | La Promenade | `promenade_picks` |
| Liste complète des Bads (Visiteurs uniquement) | La Découverte | `discover_bads` |
| Pari + mot du Visiteur | La Demande de parloir | `visit_requests` |
| Demandes de visite reçues par le Bad | Le Courrier | `visit_requests` (côté Bad) |
| Refus / fin | Affaire classée | `status = 'dismissed'` / `'closed'` |
| Créneaux proposés | Les Heures de visite | `visit_slots` |
| Lieu où l'on discute (visite de 30 min, puis sans horaire avec le Permis permanent) | Le Parloir | `visits`, `conversation`, `message` |
| Les deux veulent continuer | Le Permis permanent (le Parloir reste ouvert entre eux, sans horaire) | `visits.outcome = 'released'` |
| Vrai rendez-vous à deux | La Cavale | `date_proposals` |
| Le QCM | L'Interrogatoire (« INTERROGATOIRE · 3/10 ») | `questions`, `answers` |
| Score QCM | Indice de complicité | `complicity_score` |
| Présentation du Bad | Note comportementale | `profile.bio` |
| Bloc identité de la Fiche | Identité du sujet | `get_fiche` |
| Identifiant public de la Fiche | N° d'écrou (aléatoire, jamais l'id interne) | Phase 4 |
| Étape photos du Bad (3 poses : face, profil gauche, profil droit) | Passe à la toise / Photo signalétique | `photos.position` 0, 1, 2 |
| Règles photo | Le règlement du Greffe ; bouton « Déposer au Greffe » | |
| Agenda des visites | Tableau des visites | `visits` |
| Écran de visite | Parloir · Cabine n° | `visits` |
| Liste des demandes du Visiteur | Mes demandes de parloir | `get_my_requests` |
| Aide à l'écriture | Le Souffleur | `lib/prompter` |
| Badge de confiance du Bad | Bonne conduite | `profile.is_reglo` |
| Badge de confiance du Visiteur | Casier vierge | calculé |
| Présence aux visites | Visites honorées | calculé |
| Plafond de demandes atteint | Parloir complet | `profile.requests_open = false` |
| Ville / zone de lancement | Le Quartier (« Ton quartier ouvre bientôt ») | `launch_zones` |
| Tribus / centres d'intérêt | Signes distinctifs | `tribes` |
| Sorties de groupe (V2) | La Virée | hors MVP |

Termes **retirés** (v7) : Plaidoirie, Plaider, Libérer / Libération / LIBÉRÉ·E, aveux (on dit toujours « chefs d'accusation » : un faux n'est pas un aveu), « deviner le faux », Coupables tous les deux, « Le Juge, c'est toi » et « Ici, c'est toi le juge » (aucun « juge » dans l'interface), Réglo, L'Audience du soir, Ta ville ouvre bientôt. « Match » reste interdit, même pour dire qu'il n'y en a pas.
Termes **interdits** dans l'UI : « match », « swipe », « like », « juge ». Aucun insigne ni nom d'administration réelle (police, gendarmerie, justice, administration pénitentiaire).
Les **fonctions de sécurité gardent des mots simples** : Signaler, Bloquer, Conseils sécurité.

## Identité visuelle

- Palette : noir `#0E0E10` (fond), or `#D4A437`, rouge `#E0233F`, crème `#F2E8D5` (texte), gris `#9A9186` (texte secondaire, vérifier le contraste AA).
- **Les couleurs désignent le genre, jamais le rôle** (`docs/PARCOURS-DESIGN.md` §1) : or = homme, rouge = femme, crème = non-binaire ou autre. L'interface prend la couleur de la personne connectée ; ce qui représente quelqu'un prend la couleur de la personne affichée. Le rôle se lit à l'étiquette « BAD » (barreaux) / « VISITEUR » (combiné) et aux matières (dossier, cellule / permis, vitre). Sur la landing, les portes Bad / Visiteur sont crème.
- Polices (via `next/font/google`, auto-hébergées) : **Anton** (titres), **Inter Tight** (texte), **Special Elite** (tampons, Casier), **Yellowtail** (signature, usage rare).
- Thème sombre par défaut. Mobile-first. Contraste WCAG AA obligatoire.
- Logo : `public/brand/logo-3d.png` (visuel fourni, pour la home et l'image Open Graph). Crée en plus un **logo SVG plat** (monogramme : B miroir or couronné + B rouge avec cornes et queue de diable) pour le header, le favicon et l'icône PWA.
- Éléments signature : fond « toise » sur la photo principale de la Fiche, tampons animés « BONNE CONDUITE » / « PERMIS DÉLIVRÉ » / « VISITE ACCEPTÉE » / « PERMIS PERMANENT » / « AFFAIRE CLASSÉE » (« COUPABLE » reste un décor de marque).
