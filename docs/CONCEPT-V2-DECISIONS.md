# Concept v2 — validation du porteur (2026-10-03)

> Réponses au message de présentation de l'impact. Applique-les dans SPEC.md, SCHEMA.md et PROGRESS.md, ouvre la PR de la branche concept-v2 vers main, puis démarre la **Phase 2b**.

## A. Les 13 règles « proposé v7 » : validées, avec un ajout majeur (règle 14)

Règles 1 à 13 **validées telles quelles**.

**14. Le Bad ne voit ni le chef d'accusation choisi ni le pari avant la visite** (corrige le risque « le Bad déduit le résultat du pari »).
- Pour décider, le Bad voit uniquement : le Permis de visite (photo, pseudo, âge, ville, Motif de visite, Casier vierge, Visites honorées), l'indice de complicité, les 3 points communs du QCM, et le mot facultatif du Visiteur.
- Le chef d'accusation choisi **et** le résultat du pari sont révélés **ensemble**, comme premier message du Parloir à l'ouverture de la visite : « Il/elle a parié sur : "…" — Bien vu ! » ou « — Raté ! Le vrai était : "…" ».
- Le Souffleur ne propose pas d'accroche qui cite le chef d'accusation choisi ; l'interface prévient le Visiteur : « Ton pari reste secret jusqu'à la visite. »
- Le pari n'influence donc jamais l'acceptation, conformément au principe « le pari n'a aucune importance, c'est un brise-glace ».
- Garde la métrique « taux d'acceptation selon pari juste/faux » : elle doit maintenant être neutre ; si elle ne l'est pas, c'est un bug de fuite d'information.

## B. Seuil d'ouverture
- Planchers absolus validés : 50 Bads, au moins 20 bad girls, **au moins 10 bad boys (gardé, réglable, 0 pour désactiver)**.
- Ne compter que les Bads connectés depuis moins de 30 jours : **validé**.

## C. Greffe minimal en Phase 3
**Validé** : validation des photos (et du Permis) avancée en Phase 3.

## D. Plan des phases
**Validé**, en commençant par la Phase 2b, avec une règle supplémentaire : la **Phase 5 s'arrête après chaque sous-phase** (5a Web Push, 5b Heures de visite, 5c Visite au Parloir), avec validation et test sur téléphone à chaque fois. C'est la partie la plus risquée.

## E. Risques notés (pas d'action immédiate)
- Capacité de la Promenade : accepté, à suivre dans le tableau de santé.
- Realtime gratuit (200 connexions simultanées) : repli par interrogation validé ; mesurer en Phase 8.
- iPhone : push seulement si le site est installé (iOS 16.4+) ; guide d'installation prévu.
- Web Push via les services des navigateurs : à écrire dans la politique de confidentialité ; contenu neutre (règle 11).
