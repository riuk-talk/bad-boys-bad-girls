# Phase 1 — Décisions du porteur de projet

> Phase 1 **validée**. Applique ces décisions, mets à jour `SPEC.md` et `PROGRESS.md`, puis passe à la Phase 2 quand l'URL Supabase et la clé publishable te sont fournies.

## A. Écarts à valider

1. **Budget JS** : la mesure **Brotli** fait foi (c'est ce que Vercel transfère). 117 Ko : validé.
2. **LCP** : le critère qui fait foi est le **LCP réel des visiteurs, 75e centile < 2,5 s** (définition des Core Web Vitals). En laboratoire (Lighthouse mobile simulé), tolérance jusqu'à 3,5 s. Mesure réelle en Phase 7 via la petite bibliothèque `web-vitals` et notre propre route, données agrégées sans identifiant ni IP, conservées 90 jours.
3. **Rouge** : validé (rouge d'origine pour grands titres, bordures, décoration ; nuances dérivées pour le petit texte).
4. **Logo en `<img>` AVIF** : validé.
5. **CSP `style-src 'unsafe-inline'`** sans `unsafe-inline` pour les scripts : validé.
6. **Toutes les pages dynamiques à cause du nonce** : validé pour l'instant. En Phase 7, si le LCP réel de la landing dépasse le seuil, teste une landing et des pages légales **statiques** avec une CSP par empreintes (hash) au lieu du nonce, et mesure avant/après. Ne change rien d'ici là.
7. **ESLint 9** : validé, à mettre à jour quand le plugin Next accepte la v10.
8. **Redirection automatique de langue désactivée** : bonne décision, validée.

## B. Points contradictoires relevés

1. **Alerte d'egress** : pas d'API de gestion (secret supplémentaire inutile). L'admin affiche le **stockage** calculé en SQL depuis `storage.objects`, et pour l'egress un **champ de saisie mensuelle** + un lien vers la page d'usage Supabase. L'alerte se déclenche sur la valeur saisie.
2. **Audience à moins de 5 Fiches** : accepté (règle « sans remplissage »). Ajoute au tableau de santé par zone la **part des membres ayant reçu moins de 5 Fiches** : c'est un signal direct du déséquilibre femmes/hommes.
3. **Levée du masquage bloquée par un seul signalement** : affine la règle. Bloquent la levée : (a) tout signalement ouvert **entre les deux personnes** de la conversation ; (b) un signalement ouvert contre l'une d'elles **dans les catégories `scam`, `minor`, `harassment` ou `violence_threat`**. Les autres catégories ne bloquent pas.
4. **Comptes sans onboarding** : un seul e-mail à **J+7** (« Ta Fiche t'attend ») qui mentionne la suppression automatique à J+30. Priorité la plus basse dans `email_outbox`. Pas d'autre relance.
5. **Hook « Before User Created » et lien magique** : OK pour le tester en Phase 2. S'il ne s'exécute pas pour le lien magique, arrête-toi et propose une solution avant de continuer.

## C. Organisation

- À la fin de chaque phase validée, **ouvre une pull request vers `main`**. Je la fusionne après relecture : Vercel déploie `main` en production et chaque branche en prévisualisation, ce qui me permet de tester sur mon téléphone.
- Pour la Phase 1 : ouvre la PR maintenant.
