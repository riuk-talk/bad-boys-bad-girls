# Concept v2 — décisions du porteur de projet (2026-10-03)

> Ces décisions **remplacent** les parties correspondantes de `SPEC.md` (v6.2). Avant la Phase 3 : intègre-les dans `SPEC.md` (v7), `SCHEMA.md`, `PROMPT.md` (plan des phases) et `PROGRESS.md`, puis **présente-moi l'impact** (ce qui change dans le code déjà livré, ce qui disparaît, ce qui s'ajoute, nouvelles estimations de phases) et **attends ma validation** avant de coder.

## 1. Deux rôles : le Bad et le Visiteur

- À l'inscription, chaque membre choisit **un rôle** : **Bad** (il se met en vitrine et reçoit des demandes de visite) ou **Visiteur** (il demande des visites aux Bads). Les deux genres peuvent prendre les deux rôles.
- Le rôle est **modifiable** dans les paramètres :
  - Bad → Visiteur : le Casier est masqué ; les demandes de visite en attente sont classées avec le message neutre ; les visites programmées sont annulées avec notification à l'autre personne.
  - Visiteur → Bad : le Casier doit être rempli avant que la Fiche apparaisse ; les demandes envoyées en attente sont annulées.
  - Changement limité à 1 fois par 7 jours (évite les allers-retours abusifs).
- **Un Bad ne demande pas de visite. Un Visiteur n'en reçoit pas.**

### Fiche du Bad
Inchangée (SPEC §5) + le Casier (§2 ci-dessous).

### Fiche du Visiteur (obligatoire, non négociable pour la sécurité des Bads)
- Pseudo, âge, ville, **1 photo validée par la modération** (visage visible), présentation courte (280 caractères), signes distinctifs (facultatifs), QCM (10 questions du socle, pour l'indice de complicité).
- **Pas de Casier.**
- **Aucune demande de visite possible tant que la photo n'est pas validée.**
- Le Bad voit la Fiche complète du Visiteur avant d'accepter.

## 2. Le Casier : 1 vrai, 2 faux

- Le Bad écrit 3 chefs d'accusation : **1 vrai et 2 faux** (inverse de la v6). Il coche le vrai.
- L'assistant de Casier (amorces à trous, clichés déconseillés) est adapté : il aide à écrire un vrai fait marquant et deux faux crédibles.

## 3. La demande de visite (remplace la Plaidoirie)

**But (mots du porteur) : remplacer le match et briser le stress du premier message. Que le pari soit juste ou faux n'a aucune importance : c'est un prétexte pour entamer la conversation.**

- Sur la Fiche d'un Bad, le Visiteur appuie sur **« Demander une visite »** :
  1. il **parie sur le chef d'accusation qu'il pense vrai** ;
  2. il peut ajouter un mot (280 caractères, facultatif), avec **Le Souffleur** qui propose 3 accroches liées au chef d'accusation choisi.
- La demande part **dans tous les cas**, pari juste ou faux.
- **Le résultat du pari est gardé secret jusqu'au début de la visite** : il s'affiche comme **premier message du Parloir** (« Il/elle a parié sur : "…" — Bien vu ! » ou « — Raté ! Le vrai était : "…" »). C'est le brise-glace : personne n'a à écrire le premier message.
- Côté Bad (« Le Juge, c'est toi ») : il voit la Fiche du Visiteur, l'indice de complicité, le chef d'accusation choisi (sans le résultat) et le mot éventuel. Actions : **Accepter la visite** ou **Affaire classée** (message neutre prédéfini).
- Limites inchangées (SPEC §7) : 5 demandes / 24 h par Visiteur (2 si compte < 24 h), 1 demande en cours par couple, 30 jours après un classement, plafond de demandes en attente réglable par le Bad (« Parloir complet »), anti-arnaque.
- **Supprimé** : les plaidoiries croisées / « Coupables tous les deux » (sans objet avec des rôles séparés).

## 4. Les heures de visite (remplace l'ouverture immédiate du Parloir)

1. **Le Bad accepte et propose 2 ou 3 créneaux** de 30 min, dans les 7 jours, chacun au moins 2 h dans le futur. Raccourcis : « Ce soir », « Demain soir », « Ce week-end ».
2. **Le Visiteur choisit un créneau** dans les 48 h. Sans choix → la demande est classée automatiquement (message neutre). Il peut aussi répondre « Aucun ne me va » → le Bad propose de nouveaux créneaux (1 fois).
3. **Rappels** : notification 1 h avant et à l'heure (push + in-app ; e-mail seulement si activé, quota limité).
4. **La visite** : le Parloir s'ouvre **uniquement pendant les 30 min du créneau**, en temps réel, avec compte à rebours visible. Écran d'attente « en attente de l'autre » si une seule personne est là. Premier message automatique = résultat du pari (§3). Signaler / Bloquer toujours accessibles. Les messages sont conservés (modération, signalements).
5. **Absence** : si l'un des deux n'est pas venu au bout de 10 min, la visite est marquée « absent ». Chacun peut demander **un report** (le Bad repropose des créneaux). Deuxième absence → affaire classée automatiquement.
6. **Fin de visite** : chacun choisit **« Prolonger »** ou **« Affaire classée »** (dans les 24 h ; sans réponse = classée).
   - Les deux choisissent Prolonger → **Libération** : le Parloir devient une messagerie **libre et permanente**, et la **Cavale** (rendez-vous réel, SPEC §13) devient disponible.
   - Sinon → affaire classée, message neutre, délai de 30 jours.
7. Une seule visite programmée à la fois par couple ; un Bad peut avoir plusieurs visites programmées avec des Visiteurs différents, sans chevauchement de créneaux.

## 5. Notifications push : maintenant dans le MVP

- Les heures de visite ne fonctionnent pas sans rappels fiables : **Web Push** (clés VAPID, gratuit, service worker) passe dans le MVP.
- Android/Chrome : notifications directes. iPhone : uniquement si le site est installé sur l'écran d'accueil → afficher un guide d'installation au moment où un iPhone programme sa première visite.
- Abonnement push demandé **au bon moment** (à la première demande envoyée ou acceptée), jamais à l'arrivée sur le site.
- Respect de la CSP et de la vie privée : aucun service tiers de notification.

## 6. Ce qui change ailleurs

- **L'Audience du soir** : seuls les **Visiteurs** la reçoivent (5 Fiches de **Bads** chaque soir). La répartition de l'attention protège les Bads très sollicités.
- **La Découverte** : réservée aux Visiteurs (grille de Bads).
- **Les Bads** : leur écran d'accueil = « Le Juge, c'est toi » (demandes reçues) + « Mes visites » (agenda des visites programmées).
- **Le tableau de santé** ajoute : répartition Bads/Visiteurs par genre et par zone, taux d'acceptation, taux de créneau choisi, taux de présence aux visites, taux de Libération après visite.
- **Seuil d'ouverture d'une zone** : à recalculer avec les deux rôles (à me proposer).
- **Onboarding** : nouvelle étape « Ton rôle » juste après l'identité ; le Casier n'est demandé qu'aux Bads ; la photo validée est requise pour les deux rôles.

## 7. Vocabulaire mis à jour

| Concept | Nom produit | Nom technique proposé |
|---|---|---|
| Membre qui reçoit | Le Bad | `profile.role = 'bad'` |
| Membre qui demande | Le Visiteur | `profile.role = 'visitor'` |
| Pari + mot du visiteur | Demande de visite | `visit_requests` (remplace `pleas`) |
| Créneaux proposés | Heures de visite | `visit_slots` |
| Visite de 30 min | La visite au Parloir | `visits` |
| Fin de visite réussie | Libération | `visits.outcome = 'released'` |
