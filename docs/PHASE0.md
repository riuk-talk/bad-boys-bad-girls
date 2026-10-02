# Phase 0 — Cadrage

> Document de travail produit en Phase 0. Aucun code applicatif. À valider par le porteur du projet.
> Le schéma de base détaillé est dans [`docs/SCHEMA.md`](./SCHEMA.md).
> Date des vérifications : 2026-10-01. Les quotas changent : **revérifie-les le jour du déploiement**.

---

## 1. Vérifications (documentation officielle)

| Point | Résultat | Source | Fiabilité |
|---|---|---|---|
| Version stable de Next.js | **16.3.8** (registre npm, tag `latest`). Next 16 : `middleware.ts` est remplacé par **`proxy.ts`** (runtime Node), `params`/`cookies()`/`headers()` asynchrones, Turbopack par défaut, `next lint` supprimé (ESLint appelé directement), Node ≥ 20.9. | registry.npmjs.org/next/latest, nextjs.org/blog/next-16 | Vérifié |
| `pg_cron` sur l'offre gratuite Supabase | **Disponible** : aucune restriction de plan dans la doc officielle Supabase Cron (« every second to once a year », recommandation : ≤ 8 jobs simultanés, ≤ 10 min par job). Plusieurs sources secondaires confirment la disponibilité sur Free. | supabase.com/docs/guides/cron | Doc officielle muette sur le plan → **à confirmer en Phase 1** en activant l'extension sur le projet de dev |
| Supabase Free | 500 Mo de base, **1 Go de stockage fichiers**, **5 Go d'egress** + 5 Go d'egress en cache, 50 000 MAU, **200 connexions Realtime simultanées**, 2 M messages Realtime/mois, 500 000 invocations Edge Functions, **pause après 1 semaine d'inactivité**, **2 projets actifs max**. | supabase.com/pricing | Vérifié |
| Supabase Auth, e-mails | SMTP intégré : **2 e-mails/heure** (inutilisable en production). Avec SMTP personnalisé : limite réglable. Inscriptions/connexions : 30 requêtes / 5 min par IP (réglable). Lien magique : 60 s entre deux demandes. | supabase.com/docs/guides/auth/rate-limits | Vérifié |
| Supabase Auth + Turnstile | Support **natif** de Cloudflare Turnstile (`captchaToken` passé à `signUp` / `signInWithPassword` / `signInWithOtp`). Pas besoin de vérifier le jeton nous-mêmes. | supabase.com/docs/guides/auth/auth-captcha | Vérifié |
| Clés API Supabase | Les clés `anon` et `service_role` (JWT) sont **dépréciées fin 2026**. Utiliser les nouvelles clés `sb_publishable_…` et `sb_secret_…`. | supabase.com/docs/guides/api/api-keys | Vérifié |
| Vercel Hobby | Usage **non commercial uniquement**. 1 M invocations de fonctions, 4 h CPU actif, 100 Go de transfert, 5 000 transformations d'images, durée max d'une fonction 300 s, 100 déploiements/jour, logs 1 h. | vercel.com/docs/plans/hobby | Vérifié |
| Cron Vercel Hobby | 100 crons/projet, mais **1 exécution par jour max** et précision **à l'heure près (±59 min)**. Une expression plus fréquente fait échouer le déploiement. | vercel.com/docs/cron-jobs/usage-and-pricing | Vérifié |
| Cloudflare Turnstile Free | 20 widgets, 10 noms d'hôte par widget, vérifications illimitées. | developers.cloudflare.com/turnstile/plans | Vérifié |
| Resend Free | **100 e-mails/jour**, 3 000/mois, 3 domaines. | resend.com/pricing | Vérifié |
| Brevo Free | **300 e-mails/jour**, SMTP et API transactionnels inclus. | brevo.com/free-smtp-server + sources secondaires (la page tarifs n'a pas pu être lue) | **Vérifie ça avant d'agir** (chiffre exact et présence éventuelle d'une mention « Brevo » dans les e-mails gratuits) |

### Décisions qui en découlent (proposées)

1. **Tâches planifiées : `pg_cron`** (et non le cron Vercel). Le cron Vercel Hobby est limité à 1 exécution/jour à ±59 min, incompatible avec « Audience générée dans l'heure qui précède 21 h » sur plusieurs fuseaux et avec le report d'e-mails. Les jobs purement SQL tournent dans Postgres ; les jobs qui envoient des e-mails appellent une route Next.js sécurisée via `pg_net` (secret stocké dans Supabase Vault). Si `pg_cron` s'avère indisponible : repli sur 1 cron Vercel quotidien + exécution « paresseuse » à la première requête après 20 h.
2. **SMTP : Brevo** (300/jour contre 100 pour Resend, société française, hébergement UE). Le même quota sert aux e-mails d'authentification **et** aux notifications : les e-mails d'auth sont prioritaires, les notifications passent par une file (`email_outbox`) reportée au lendemain si le quota est atteint.
3. **Clés Supabase nouvelle génération** (`sb_secret_…` à la place de `service_role`). Le fichier reste `lib/supabase/admin.ts`, la règle de CLAUDE.md s'applique à l'identique. C'est un écart de vocabulaire par rapport à CLAUDE.md, pas de principe.
4. **`proxy.ts`** à la place de `middleware.ts` (rafraîchissement de session Supabase + négociation de langue next-intl).
5. **Turnstile via l'intégration native Supabase Auth.**
6. **Région Supabase : UE (Paris `eu-west-3` de préférence, sinon Francfort).** Région des fonctions Vercel : `cdg1` (Paris) si le plan Hobby permet de la choisir — **je ne suis pas sûr** que Hobby autorise le choix de région ; à vérifier à la création du projet.

---

## 2. Ambiguïtés, contradictions et risques (classés par gravité)

Chaque point a une **recommandation**. Ceux marqués **❓** demandent ta décision (repris en §7).

### 🔴 Critique

**R1. Le stockage gratuit (1 Go) plafonne le site à quelques centaines de membres.** ❓
Calcul : 6 photos × (≈ 250 Ko + ≈ 40 Ko) ≈ 1,7 Mo par membre complet → ~600 membres à 6 photos ; ~1 700 à 2 photos en moyenne. Les deux premières zones visent 150 Fiches chacune, donc ça passe au lancement, mais le plafond arrive vite.
Même problème pour l'**egress (5 Go/mois)** : un site de rencontre affiche beaucoup de photos. 5 Go ≈ 125 000 vignettes de 40 Ko ou 20 000 photos pleine taille par mois, tous membres confondus.
→ Recommandation : (a) viser 180 Ko pour la grande taille et 30 Ko pour la vignette, vignettes partout sauf sur la Fiche ouverte ; (b) supprimer immédiatement les fichiers `photos-pending` après décision ; (c) en-têtes `Cache-Control` longs (chemins UUID immuables) pour profiter de l'egress en cache ; (d) tableau de bord admin avec l'usage stockage/egress ; (e) **prévoir dès maintenant le seuil de bascule** vers Supabase Pro (~25 $/mois) ou un stockage objet externe. C'est une dépense future : à décider, rien à payer aujourd'hui.

**R2. Bucket public `photos` vs principe « Rien n'est public » (§2.4, §11).** ❓
Un bucket public sert les fichiers sans session à quiconque a l'URL. Le chemin UUID non devinable limite le risque mais une URL partagée reste accessible à vie.
→ Alternative : bucket privé + URLs signées. Coût : chaque URL signée est différente → le cache navigateur/CDN fonctionne moins bien (plus d'egress, voir R1), et une requête de signature par photo affichée.
→ Recommandation : garder le **bucket public avec chemins UUID** (choix de la spec) **et** renommer le chemin (nouvel UUID) quand un membre supprime une photo, se met en pause longue ou est banni, et purger à la suppression du compte. Mentionner dans la politique de confidentialité que les photos validées sont servies par URL non devinable. À valider par toi.

**R3. Vercel Hobby = usage non commercial.**
Un site de rencontre gratuit sans revenus est a priori couvert, mais la frontière « commercial » est appréciée par Vercel. Toute monétisation (même la boutique §20) impose Vercel Pro (20 $/mois). Déjà noté dans §21 de la spec ; je le rappelle parce que la sanction est la mise en pause du compte. **Vérifie les conditions (fair use guidelines) avant l'ouverture publique.**

**R4. Conformité : données art. 9 + AIPD.**
Les genres recherchés révèlent l'orientation sexuelle. Un traitement à grande échelle de données sensibles relève très probablement d'une **analyse d'impact (AIPD) obligatoire** selon la CNIL. Je ne suis pas sûr du seuil « grande échelle » appliqué à un lancement local : **à faire valider par un juriste**. Idem pour le transfert de données hors UE via Vercel (société américaine, fonctions qui traitent des données personnelles) : vérifier le DPA Vercel et l'adhésion au Data Privacy Framework.

**R5. Pause automatique de Supabase Free après 7 jours d'inactivité.**
Pendant la phase « Ta ville ouvre bientôt », le trafic peut être faible. Je ne suis pas sûr que l'activité interne de `pg_cron` compte comme « activité » pour Supabase. Une base en pause = site mort et jobs arrêtés.
→ Recommandation : 1 cron Vercel quotidien (gratuit) qui appelle une route `/api/health` faisant une requête réelle à la base.

### 🟠 Élevé

**R6. « Impossible de créer un compte < 18 ans même via l'API » vs ordre de l'onboarding.** ❓
Le compte Supabase Auth (`auth.users`) est créé à l'inscription, **avant** la saisie de la date de naissance (étape 1 de l'onboarding). On ne peut donc pas empêcher la création du compte d'authentification lui-même.
→ Recommandation : la contrainte 18+ porte sur la **Fiche** (trigger Postgres sur `profiles.birthdate`) ; une Fiche sans date de naissance valide n'est visible nulle part et ne peut rien faire (toutes les fonctions vérifient `onboarding_completed_at`) ; les comptes d'auth sans onboarding terminé sont supprimés après 30 jours. Le critère de la Phase 2 devient : « impossible d'avoir une Fiche utilisable avec un âge < 18 ans, même via l'API ».

**R7. Le masquage des coordonnées levé après 10 messages chacun facilite les arnaques.**
Un arnaqueur patient envoie 10 messages sans difficulté. La levée après une Cavale acceptée est plus robuste.
→ Recommandation : garder la règle de la spec (elle est délibérée), mais **ne pas lever le masquage** si l'un des deux comptes a moins de 7 jours ou fait l'objet d'un signalement ouvert. ❓

**R8. Suppression du compte vs conversation qui reste visible pour l'autre (§10 vs §13).**
La spec exige une « suppression réelle en cascade » **et** que la conversation reste visible avec « Ce compte a été supprimé ». Les messages de la personne supprimée sont ses données personnelles.
→ Recommandation : conserver les messages avec `sender_id = NULL` (plus aucun lien avec l'identité), pseudo et photo supprimés. Défendable (les messages sont aussi des données de l'autre personne), mais **à faire valider par un juriste**. Alternative stricte : remplacer le texte par « Message supprimé ». ❓

**R9. Plaidoirie croisée et « Parloir complet ».** ❓
Si B a plaidé auprès de A puis que A veut plaider auprès de B alors que B est « Parloir complet », le bouton est désactivé : la libération mutuelle devient impossible alors que B a lui-même fait le premier pas.
→ Recommandation : une plaidoirie qui **croise** une plaidoirie en attente en sens inverse est toujours autorisée (elle ne charge pas B : elle libère au lieu d'ajouter une plaidoirie en attente). Les autres limites (5/24 h, blocage, réciprocité) s'appliquent quand même.

**R10. CSP stricte vs performance de la landing.**
Une CSP stricte avec Next.js demande un *nonce* par requête, ce qui rend toutes les pages dynamiques (plus de page statique en cache), donc landing plus lente et plus d'invocations de fonctions.
→ Recommandation : CSP avec nonce sur l'application connectée ; sur la landing et les pages légales (statiques, sans données), CSP stricte **sans** `unsafe-eval`, avec hachages des scripts inline générés au build si possible, sinon `'unsafe-inline'` **uniquement pour `script-src` de ces pages statiques**. Je documenterai le choix exact en Phase 1 après mesure. Je n'affaiblis rien sans te le soumettre.

**R11. Pas de Docker fonctionnel dans l'environnement de travail actuel.**
Le binaire Docker existe mais le démon ne tourne pas dans ce conteneur cloud : impossible de lancer Supabase en local ici. Les tests pgTAP (`supabase test db`) devront tourner contre un **projet Supabase de développement** (1 des 2 projets gratuits ; le 2e sera la production) ou sur ta machine avec Docker. Conséquence : il faudra me fournir les accès au projet de dev (voir §6).

### 🟡 Moyen

**R12. Définition de « Fiche complète » (seuil d'ouverture, §3).** ❓
Proposition : onboarding terminé (6 étapes) **et** photo principale validée. La jauge « Fiche complète à X % » (§4) est une autre mesure (présentation, signes distinctifs, photos, 20 questions).

**R13. Quel est le délai de 30 jours après une plaidoirie classée : dans un sens ou les deux ?** ❓
§7 : « expéditeur → destinataire » ; §13 (Parloir classé) : « entre ces deux personnes ».
→ Recommandation : plaidoirie classée ⇒ 30 jours dans le sens A→B uniquement (B reste libre de plaider auprès de A) ; Parloir classé ⇒ 30 jours dans les deux sens.

**R14. Le classement automatique à 7 jours compte-t-il comme un classement ?** ❓
→ Recommandation : oui pour le délai de 30 jours (sinon on replaide auprès d'une personne qui n'a pas répondu) ; **non** pour les « 3 affaires classées de suite » (on ne conseille pas quelqu'un pour l'inactivité des autres).

**R15. Fiche en pause : peut-elle plaider et recevoir l'Audience ?** ❓
→ Recommandation : en pause, on ne plaide pas et on ne reçoit pas d'Audience ; on peut répondre aux plaidoiries reçues et utiliser le Parloir.

**R16. Fiche en attente de modération : peut-elle plaider ?** ❓
→ Recommandation : non. Plaider exige une photo principale validée (protège la personne sollicitée, principe §2.2).

**R17. Découverte et zones.** ❓
→ Recommandation : la zone d'un membre est déterminée par sa ville (zone ouverte la plus proche dont le rayon contient la commune). La Découverte montre les Fiches de **toutes les zones ouvertes**, filtrées par la distance choisie ; « France » = toutes les zones ouvertes.

**R18. « Hash salé » de l'e-mail des bannis.**
Un sel aléatoire empêche de retrouver l'e-mail au moment d'une réinscription. Il faut un hachage **déterministe avec secret** : HMAC-SHA256(e-mail normalisé, poivre secret). Ce n'est pas un affaiblissement, c'est la bonne primitive. Normalisation : minuscules, suppression des espaces ; je ne retire **pas** les `+suffixe` ni les points Gmail sans ton accord (faux positifs possibles). ❓

**R19. Anti-arnaque « quasi identiques » : définition.** ❓
→ Proposition : normalisation (minuscules, sans accents, sans ponctuation, espaces réduits, coordonnées masquées) puis similarité trigramme (`pg_trgm`) ≥ 0,9, sur une fenêtre de 7 jours, messages vides exclus. 3 occurrences ⇒ signalement automatique (pas de blocage).

**R20. Répartition de l'attention : formule non spécifiée.** ❓
→ Proposition : score de classement = indice de complicité (0–100) + bonus d'activité (0–20) ; multiplié par 0,5 si plaidoiries en attente > 50 % du plafond ; et une Fiche apparaît dans au plus `N` Audiences par jour (`N` = 20 par défaut, paramétrable). Le test de la Phase 4 mesurera la fréquence d'apparition sur le seed.

**R21. Contenu à rédiger par moi : est-ce de l'« invention » ?**
Les 60 amorces du Casier, les 30+ modèles du Souffleur, la liste de départ des mots-clés de modération et les traductions EN du QCM sont du **contenu produit**, pas de fausses données. Je les rédige et tu les relis. Les textes juridiques restent des modèles `[À FAIRE VALIDER PAR UN JURISTE]`.

**R22. Référentiel des communes.**
Source proposée : jeu de données officiel des communes (API Découpage administratif `geo.api.gouv.fr` / data.gouv.fr, Licence Ouverte Etalab). ~35 000 lignes, quelques Mo : compatible avec les 500 Mo. Import par script de seed, pas de données inventées. **Vérifie la licence avant la mise en production.**

**R23. E-mails et quota (300/jour).**
L'ouverture d'une ville à 150+ membres consomme la moitié du quota d'un coup, en concurrence avec les e-mails d'inscription. → Envoi étalé par la file `email_outbox` (priorité : auth > Cavale acceptée > ouverture de ville > récapitulatif plaidoiries > Fiche en veille).

**R24. Les réponses QCM d'un membre sont-elles visibles par les autres ?** ❓
La spec ne le dit pas. Le Souffleur révèle déjà une réponse de l'autre (« Toi X, moi Y »), et la Fiche affiche 3 points communs.
→ Recommandation : jamais de liste complète ; seulement les 3 points communs et les réponses utilisées par le Souffleur, uniquement pour un visiteur connecté pouvant voir la Fiche.

**R25. Export des données (« toutes ses données et rien d'autre »).** ❓
→ Recommandation : ses propres messages (avec date et identifiant de conversation, sans le texte de l'autre personne), ses plaidoiries envoyées/reçues (sans les données de l'expéditeur au-delà de son pseudo), ses réponses QCM, consentements, signalements qu'il a faits (sans données de la cible), notifications.

**R26. Pages indexées : landing seule (§4, Phase 1) ou landing + pages légales (§10) ?** ❓
→ Recommandation : landing + pages légales + Charte indexables (aucune donnée personnelle, utile pour la confiance). Tout le reste `noindex`.

### 🟢 Faible

**R27. Tableau cassé dans CLAUDE.md** : les lignes « Ville pas encore ouverte » et « Signes distinctifs » sont après le paragraphe « Termes interdits » et ne font plus partie du tableau. Correction cosmétique proposée (je ne modifie pas CLAUDE.md sans ton accord).
**R28. Le logo SVG plat** (B miroir couronné + B à cornes) : je peux le dessiner, mais la qualité d'un monogramme tracé à la main en SVG sera inférieure à celle d'un graphiste. Si tu as une version vectorielle, fournis-la. ❓
**R29. « 3 principaux points communs »** : questions avec la même réponse, triées par somme des importances des deux personnes, puis ordre des questions.
**R30. Parité SQL/TS de l'indice** : calcul en entiers (sommes de poids) puis arrondi « au plus proche, 0,5 vers le haut » des deux côtés pour éviter les écarts d'arrondi flottant.
**R31. Déblocage** : la spec ne le prévoit pas. Proposition : possible depuis les paramètres ; la conversation fermée reste fermée, les plaidoiries annulées ne reviennent pas.
**R32. Nom de domaine : ce n'est pas gratuit** (~10 €/an). Sans domaine, l'envoi d'e-mails est quasi impossible (SPF/DKIM/DMARC exigés par Gmail/Outlook). C'est la seule dépense que je considère inévitable. ❓

---

## 3. Arborescence proposée

```
.
├── app/
│   ├── [locale]/
│   │   ├── (public)/                # landing, légales, charte, conseils sécurité (indexables sauf conseils)
│   │   │   ├── page.tsx
│   │   │   ├── charte/  cgu/  confidentialite/  mentions-legales/  conseils-securite/
│   │   ├── (auth)/                  # connexion, inscription, lien magique, mot de passe oublié
│   │   ├── (app)/                   # tout ce qui exige une session (noindex)
│   │   │   ├── onboarding/[step]/
│   │   │   ├── audience/            # écran d'accueil principal
│   │   │   ├── decouverte/
│   │   │   ├── fiche/[id]/          # Fiche publique
│   │   │   ├── ma-fiche/            # aperçu + édition
│   │   │   ├── juge/                # plaidoiries reçues (« Le Juge, c'est toi »)
│   │   │   ├── parloir/  parloir/[conversationId]/
│   │   │   ├── ville-bientot/       # « Ta ville ouvre bientôt »
│   │   │   ├── notifications/
│   │   │   └── parametres/          # pause, plafond, e-mails, export, suppression, bloqués
│   │   ├── admin/                   # réservé à admin_users
│   │   ├── not-found.tsx  error.tsx
│   │   └── layout.tsx
│   ├── api/
│   │   ├── cron/[job]/route.ts      # appelé par pg_net (secret partagé)
│   │   ├── health/route.ts          # anti-pause Supabase (cron Vercel quotidien)
│   │   └── auth/callback/route.ts
│   ├── robots.ts  sitemap.ts  manifest.ts  opengraph-image.tsx
├── components/
│   ├── ui/                          # Button, Input, Select, Checkbox, Modal, Toast, Badge, Skeleton, EmptyState
│   ├── brand/                       # Logo SVG, Stamp (tampon animé), Toise, FicheCard
│   └── features/                    # casier/, plea/, parloir/, qcm/, audience/, admin/…
├── lib/
│   ├── supabase/                    # server.ts, browser.ts, admin.ts (clé secrète, server-only)
│   ├── complicity.ts                # miroir TS de complicity_score
│   ├── prompter/                    # Le Souffleur
│   ├── casier/                      # amorces, règles de qualité
│   ├── masking.ts                   # masquage e-mails/téléphones/liens (miroir de la fonction SQL)
│   ├── validation/                  # schémas Zod
│   ├── image/                       # compression WebP + contrôle EXIF (dynamic import)
│   └── env.ts                       # lecture typée des variables d'environnement
├── messages/  fr.json  en.json
├── i18n/  routing.ts  request.ts
├── supabase/
│   ├── config.toml
│   ├── migrations/                  # SQL versionné
│   ├── tests/                       # pgTAP
│   ├── seed.sql                     # données de référence (tribus, questions, mots-clés)
│   └── scripts/                     # create_first_admin.sql, seed_dev (garde-fou env), import_communes
├── tests/  unit/ (Vitest)  e2e/ (Playwright)
├── public/brand/
├── proxy.ts                         # session Supabase + locale (ex-middleware)
├── docs/  SPEC.md  PROMPT.md  PROGRESS.md  PHASE0.md  SCHEMA.md
└── .env.example
```

---

## 4. Variables d'environnement

| Variable | Où | Rôle |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | client + serveur | URL canonique (liens e-mail, OG) |
| `NEXT_PUBLIC_SUPABASE_URL` | client + serveur | URL du projet Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client + serveur | clé `sb_publishable_…` (soumise à la RLS) |
| `SUPABASE_SECRET_KEY` | **serveur uniquement** (`lib/supabase/admin.ts`) | clé `sb_secret_…` (contourne la RLS) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | client | widget Turnstile (la clé secrète est saisie dans le tableau de bord Supabase Auth) |
| `BREVO_API_KEY` | serveur | envoi des notifications par l'API transactionnelle |
| `EMAIL_FROM` | serveur | expéditeur, ex. `Bad Boys & Bad Girls <bonjour@domaine.fr>` |
| `CRON_SECRET` | serveur (+ Vault Supabase) | authentifie les appels `pg_net` → `/api/cron/*` et le cron Vercel |
| `BAN_EMAIL_PEPPER` | Vault Supabase (lu par la fonction SQL) | secret du HMAC des e-mails bannis (R18) |
| `APP_ENV` | serveur | `development` / `preview` / `production` |
| `ALLOW_DEV_SEED` | script de seed uniquement | doit valoir `true` **et** `APP_ENV != production` pour exécuter le seed |

Les identifiants SMTP Brevo (serveur, port, login, clé SMTP) se saisissent **dans Supabase** (Auth → SMTP), pas dans l'application.

---

## 5. Tâches planifiées (pg_cron, heure UTC)

| Job | Fréquence | Action |
|---|---|---|
| `hearings_build` | toutes les heures à :05 | pour chaque zone ouverte dont l'heure locale est 20 h : `build_daily_hearing(zone, date locale)` avec `visible_from` = 21:00 locale |
| `pleas_expire` | toutes les heures | classement automatique des plaidoiries > 7 jours |
| `emails_drain` | toutes les heures | `pg_net` → `/api/cron/emails` : envoi de la file dans la limite du quota du jour |
| `daily_maintenance` | 1×/jour, 03:15 UTC | badge Réglo, Fiches inactives (21 j / 90 j + e-mail), ouverture auto des zones, purge (fichiers pending orphelins, comptes sans onboarding > 30 j, empreintes de bannis expirées, Audiences > 30 j) |
| Cron Vercel `/api/health` | 1×/jour | évite la pause du projet Supabase (R5) |

---

## 6. Ce que tu dois créer toi-même

1. **Nom de domaine** (seule dépense, ~10 €/an, R32) chez un registrar (OVH, Gandi…). Ne le pointe nulle part pour l'instant.
2. **Supabase** (supabase.com, connexion GitHub possible) :
   1. Crée l'organisation (plan Free).
   2. Crée le projet **`bbbg-dev`**, région **West EU (Paris)** si disponible, mot de passe de base fort (garde-le dans un gestionnaire de mots de passe).
   3. Settings → API Keys : crée une clé **publishable** et une clé **secret**. Envoie-moi l'URL du projet et la clé publishable ; la clé secrète, mets-la toi-même dans les variables d'environnement de la session / de Vercel (ne la colle jamais dans un fichier versionné).
   4. Plus tard (Phase 7) : projet **`bbbg-prod`**, même région.
   5. Database → Extensions : active `pg_cron` et `pg_net` sur `bbbg-dev` et dis-moi si c'est possible (confirme la vérification §1).
3. **Cloudflare** (compte gratuit) → Turnstile → Add widget : nom `bbbg`, hostnames `localhost` + ton domaine, mode « Managed ». Note la *site key* et la *secret key* ; colle la secret key dans Supabase → Authentication → Attack Protection → Captcha (provider Turnstile).
4. **Brevo** (compte gratuit) :
   1. Senders, Domains & Dedicated IPs → ajoute ton domaine et crée les enregistrements DNS **SPF, DKIM et DMARC** qu'il indique chez ton registrar.
   2. SMTP & API → génère une clé SMTP (pour Supabase Auth) et une clé API (pour l'application).
   3. Dans Supabase → Authentication → SMTP Settings : hôte `smtp-relay.brevo.com`, port 587, login et clé SMTP Brevo, expéditeur sur ton domaine. **Vérifie ces paramètres dans l'interface Brevo, ils peuvent avoir changé.**
5. **Vercel** (plan Hobby, connexion GitHub) : importe le dépôt `riuk-talk/bad-boys-bad-girls`, ne déploie pas encore de variables de production. Note si la région des fonctions est modifiable (R6/§1).
6. **GitHub** : rien à faire (dépôt existant).

---

## 7. Questions pour toi (à trancher avant la Phase 1/2)

1. **R1** : OK pour les tailles de photos réduites (180 Ko / 30 Ko) et pour noter dès maintenant un seuil de bascule payante (stockage/egress) ?
2. **R2** : bucket public à chemins UUID (spec) ou bucket privé + URLs signées (plus privé, plus coûteux en egress) ?
3. **R6** : OK pour reformuler le critère 18+ sur la Fiche (et non le compte d'auth) ?
4. **R7** : ajouter les garde-fous « compte > 7 jours et aucun signalement ouvert » à la levée du masquage ?
5. **R8** : messages d'un compte supprimé conservés anonymisés, ou remplacés par « Message supprimé » ?
6. **R9** : une plaidoirie croisée passe-t-elle malgré « Parloir complet » ?
7. **R12** : définition de « Fiche complète » pour le seuil d'ouverture ?
8. **R13 / R14** : délais de 30 jours (sens unique vs deux sens) et prise en compte du classement automatique ?
9. **R15 / R16** : Fiche en pause ou non modérée : peut-elle plaider / recevoir l'Audience ?
10. **R17** : Découverte limitée à sa zone ou à toutes les zones ouvertes, filtrée par distance ?
11. **R18** : normaliser les alias Gmail (`+` et points) pour le blocage des bannis ?
12. **R19 / R20** : formules proposées pour l'anti-arnaque et la répartition de l'attention ?
13. **R24 / R25** : visibilité des réponses QCM et périmètre de l'export ?
14. **R26** : pages légales indexables ?
15. **R28** : as-tu un logo vectoriel, ou je dessine le monogramme ?
16. **R32** : OK pour l'achat d'un nom de domaine (seule dépense) ? Lequel ?
17. **R27** : je corrige le tableau cassé de CLAUDE.md ?
