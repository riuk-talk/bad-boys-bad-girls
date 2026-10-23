# Passage en production des phases 6 à 9 (bad-boys-prod)

**À lancer seulement après le contrôle du conseiller.** Par le porteur, dans le SQL Editor de
`bad-boys-prod` (`hmmobtyherwuhrhymfbk`). Aucun connecteur d'IA n'écrit sur la prod.

Les scripts sont générés par `scripts/build-prod-apply.mjs` : ne pas les modifier à la main.

## Contenu

| Script | Migrations | Mot destructif |
|---|---|---|
| `1-phase6-reads-type.sql` | 6a lectures, 6b type `date_cancelled` | 6a |
| `2-phase6-cavale-unmask.sql` | 6b Cavale, 6c levée du masquage | 6b, 6c |
| `3-phase7-types.sql` | 7a types | — |
| `4-phase7-moderation-pilotage.sql` | 7a modération, 7b pilotage | 7a, 7b |
| `5-phase7-jobs-rgpd.sql` | 7c tâches, 7c Fiches inactives, 7d RGPD | 7c ×2, 7d |
| `6-phase7-email-report.sql` | 7e e-mails, 7f signalement d'un message | — |
| `7-phase8.sql` | 8b Web Vitals, 8b conservation 90 jours | 8b conservation |
| `8-phase9.sql` | 9a clichés, 9b relance, 9c complices, 9e photos détourées (2 migrations) | — |
| `9-verify.sql` | contrôle, **lecture seule** | — |

## Fonctionnement

Chaque script 1 à 8 :

- tourne dans **une seule transaction** : s'il échoue, rien n'est appliqué ;
- commence par une garde : il refuse de tourner si l'étape précédente manque, ou s'il a déjà été lancé ;
- contient, pour chaque migration, le texte exact du fichier, puis sa ligne d'historique (même texte) ;
- finit par un tableau des empreintes, où la colonne « attendu » doit être égale à la colonne « base ».

Les scripts sont découpés après chaque `alter type ... add value`, car une nouvelle valeur doit être validée avant d'être utilisée.

Quand le script contient `delete`, `drop` ou `truncate`, l'éditeur demande une confirmation : c'est attendu. Il n'y a aucun `truncate`, et aucune table n'est supprimée. Les mots se trouvent à trois endroits :

- dans des corps de fonction (purges, nettoyages, `on delete set null`) ;
- en 7d, dans des objets supprimés puis recréés aussitôt : les 3 clés étrangères de `conversations` et le déclencheur `moderation_actions_append_only` ;
- en 7d, `drop not null` sur 3 colonnes de `conversations`.

## Ordre

1. Dans le SQL Editor : coller **un** script, l'exécuter, puis vérifier le tableau des empreintes. Passer ensuite au suivant, de 1 à 8.
2. Lancer `9-verify.sql`. Attendu :
   - `historique_ok` = 19, et 0 dans toutes les autres colonnes ;
   - `tables_sans_rls` = 0 ;
   - `droits_anon_tables` = 0 ;
   - `lot_photos_actif` = false : le détourage en lot est réservé à la preview, **ne jamais l'activer en production** ;
   - 11 tâches planifiées.
3. Envoyer le résultat du script 9 au conseiller.

Si l'éditeur ré-indente le texte, la comparaison sans les blancs n'est pas touchée (règle du 2026-10-22).

Le script 9 compte aussi à part les écarts qui ne tiennent qu'aux commentaires `--` (`dont_commentaires_seuls`). C'est une information : la règle reste « sans les blancs ».

## Avant et après (hors de ces scripts)

- Avant : sauvegarde de la prod. Sur l'offre gratuite, pas de restauration à un instant donné : faire un export du schéma et des données depuis le tableau de bord.
- Après :
  - les clés de notification propres à la prod (checklist de lancement) ; sans elles, `push_dispatch`, `email_dispatch` et `cleanup_dispatch` ne font rien ;
  - la fusion de `phase-9` dans `main` ;
  - le déploiement Vercel.
- Le nettoyage quotidien (`cleanup`, 2 h 40) supprime les lignes anciennes dès la première nuit. Il n'agit que sur les envois de plus de 30 jours, les jours d'activité de plus de 400 jours et les Web Vitals de plus de 90 jours.

## Régénérer (après une modification de migration)

```sh
pnpm exec supabase db reset          # base locale construite avec les fichiers
docker exec -i <conteneur supabase_db> psql -U postgres -At -F $'\t' \
  < supabase/scripts/prod-apply/expected-functions.sql \
  > supabase/scripts/prod-apply/expected-functions.tsv
node scripts/build-prod-apply.mjs supabase/scripts/prod-apply/expected-functions.tsv
```

## Testé (2026-10-23)

Le test a été fait sur une base locale remise à l'état de `main` (`supabase db reset --version 20261018150000`), avec les scripts 1 à 8 lancés dans l'ordre :

- empreintes égales pour les 19 migrations ;
- script 9 : 19 / 0 / 0, aucune fonction absente, en trop ou différente (197 fonctions), droits identiques, 0 table sans RLS, lot désactivé, 11 tâches ;
- un second lancement du script 8 est refusé par la garde.
