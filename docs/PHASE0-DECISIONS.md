# Phase 0 — Décisions du porteur de projet

> Réponses aux 17 questions de `PHASE0.md` §7 et corrections du schéma `SCHEMA.md`.
> Mets à jour `SPEC.md`, `SCHEMA.md` et `PROGRESS.md` en conséquence avant la Phase 1, et signale tout ce qui te paraît contradictoire.

## A. Réponses aux 17 questions

1. **R1 — Photos** : OK pour 180 Ko / 30 Ko, vignettes partout sauf Fiche ouverte, purge immédiate de `photos-pending`, `Cache-Control` long. **Seuil de bascule** : quand le stockage dépasse 700 Mo **ou** l'egress dépasse 3,5 Go/mois deux mois de suite, alerte dans le tableau de bord admin ; la décision de payer reste humaine.
2. **R2 — Bucket** : bucket **public à chemins UUID** (choix de la spec, pour l'egress gratuit), avec rotation de chemin à la suppression d'une photo, à la pause longue (> 30 jours), au bannissement, et purge à la suppression du compte. À mentionner dans la politique de confidentialité.
3. **R6 — 18+** : OK, le critère porte sur la Fiche. Comptes d'auth sans onboarding terminé supprimés après 30 jours.
4. **R7 — Levée du masquage** : OK, garde-fous ajoutés : les deux comptes ont plus de 7 jours **et** aucun signalement ouvert entre eux ou contre l'un d'eux.
5. **R8 — Compte supprimé** : **option stricte**. Les messages de la personne supprimée sont remplacés par « Message supprimé » (texte effacé en base, pas seulement masqué). La conversation reste visible pour l'autre avec « Ce compte a été supprimé ».
6. **R9 — Plaidoirie croisée** : OK, elle passe malgré « Parloir complet ». Les autres limites s'appliquent.
7. **R12 — Fiche complète** : OK, onboarding terminé + photo principale validée.
8. **R13 / R14 — Délais** : OK pour tes recommandations (plaidoirie classée = 30 j dans le sens A→B ; Parloir classé = 30 j dans les deux sens ; classement auto = compte pour le délai, pas pour les « 3 affaires classées »).
9. **R15 / R16 — Pause et modération** : OK pour tes recommandations.
10. **R17 — Découverte** : OK, toutes les zones ouvertes, filtrées par distance.
11. **R18 — Alias Gmail** : pas de normalisation des `+` ni des points. HMAC-SHA256 avec poivre : OK.
12. **R19 / R20 — Formules** : OK pour l'anti-arnaque. Pour l'Audience : OK pour la formule, mais **plafond d'apparitions par défaut = 10 par jour** (et non 20) : avec 150 membres et un plafond de plaidoiries de 15, 20 apparitions par jour submergeraient les profils les plus demandés. Paramétrable.
13. **R24 / R25 — QCM et export** : OK pour tes recommandations.
14. **R26 — Indexation** : OK, landing + pages légales + Charte indexables ; tout le reste `noindex`.
15. **R28 — Logo** : pas de version vectorielle pour l'instant (demande en cours à l'initiateur du projet). Dessine le monogramme SVG plat selon CLAUDE.md ; il sera remplacé si un fichier vectoriel arrive.
16. **R32 — Domaine** : OK pour l'achat, c'est la seule dépense acceptée. Nom : `[À COMPLÉTER : domaine choisi]`. Utilise `[DOMAINE]` comme valeur provisoire partout.
17. **R27 — CLAUDE.md** : oui, corrige le tableau cassé.

## B. Corrections du schéma (non relevées en Phase 0)

1. **Recalcul des zones** : `zone_id` n'est calculé qu'à l'enregistrement de la ville. Quand l'admin crée ou modifie une zone (centre, rayon), `admin_upsert_zone` doit **recalculer `zone_id` de tous les membres concernés**. Sinon les membres inscrits avant la création de leur zone n'y sont jamais rattachés et la jauge reste fausse. Test pgTAP à ajouter.
2. **Fiche d'un interlocuteur en pause ou inactif** : `can_view_profile` refuse une cible en pause. Dans le Parloir et dans « Le Juge, c'est toi », on doit pouvoir ouvrir la Fiche de la personne avec qui on a une conversation ou une plaidoirie en cours, même si elle est en pause ou inactive. Ajoute cette exception à `get_fiche` (le blocage reste prioritaire).
3. **Performance de `build_daily_hearing`** : le calcul est quadratique (chaque membre × chaque candidat × réponses). Écris-le en SQL ensembliste (agrégation des réponses une seule fois, pas de boucle par paire) et ajoute un critère en Phase 4 : **génération pour 5 000 membres de seed dans une même zone en moins de 5 minutes** (la doc Supabase Cron recommande moins de 10 min par job).
4. **Empreintes des bannis** : avant d'écrire un trigger `before insert on auth.users`, vérifie si le **hook d'authentification Supabase « Before User Created »** est disponible sur l'offre gratuite. S'il l'est, utilise-le (méthode supportée, ne risque pas de casser toutes les inscriptions en cas de bug dans un trigger du schéma `auth`). Sinon, trigger, avec un test qui prouve qu'une inscription normale passe.
5. **`date_proposals.starts_at`** : pas de contrainte `CHECK` avec `now()` (non immuable, revalidée de façon imprévisible). Contrôle de date future dans `propose_date` / `respond_date`.
6. **Anti-arnaque** : la comparaison porte sur les messages du **même expéditeur** sur 7 jours ; l'index `(sender_id, created_at desc)` suffit, l'index GIN trigramme global sur `message_normalized` est inutile (à retirer sauf mesure contraire).
7. **Realtime** : Postgres Changes avec RLS vérifie chaque changement pour chaque abonné. Acceptable au lancement ; note dans `PROGRESS.md` la bascule vers Realtime Broadcast si les mesures de la Phase 7 le justifient.

## C. Points juridiques (hors code, à traiter par le porteur)

- AIPD probable pour les données art. 9, transfert hors UE (Vercel), identité de l'éditeur du site : à faire valider par un juriste avant l'ouverture publique. Garde les placeholders `[À FAIRE VALIDER PAR UN JURISTE]`.

## D. Validation

Le schéma est **validé** sous réserve des corrections de la section B. Tu peux passer à la **Phase 1** dès que `SPEC.md`, `SCHEMA.md` et `PROGRESS.md` sont mis à jour. La Phase 1 ne nécessite pas encore les comptes externes ; je les crée en parallèle (domaine, Supabase dev, Turnstile, Brevo, Vercel) et je te donne l'URL du projet Supabase et la clé publishable avant la Phase 2.
