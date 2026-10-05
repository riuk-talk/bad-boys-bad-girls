# Liste de départ des mots-clés de modération (`moderation_keywords`)

> **Statut : relue et chargée** (2026-10-05, migration `20261005152114_moderation_keywords`, 108 mots : 59 FR, 49 EN). « signal » retiré à la relecture ; `harassment` laissée vide (remplie depuis l'admin en Phase 7).
> **Rôle** : un mot-clé **signale** un texte à la modération (`flagged_texts`), il **ne bloque jamais** (SPEC §6). Il s'applique au pseudo, à la présentation, au Motif de visite, aux chefs d'accusation, aux précisions des signes distinctifs, puis aux demandes et messages (Phases 4 à 6).
> **Fonctionnement** : comparaison sans accents ni majuscules, sur des mots entiers (`normalize_text`). Une expression de plusieurs mots est cherchée telle quelle. Les coordonnées (e-mails, téléphones, liens) sont déjà **masquées** automatiquement : inutile de les lister ici.
> **Principe** : peu de mots, mais précis. Un mot trop courant (« drogue » dans « drogué de moto ») crée du bruit : la modération jugera à l'usage et ajustera la liste dans l'admin (Phase 7).

| Catégorie (`report_category`) | Français | English |
|---|---|---|
| `minor` — mineurs (priorité maximale) | mineur, mineure, collégien, collégienne, lycéen, lycéenne, ado, 15 ans, 16 ans, 17 ans | minor, underage, schoolgirl, schoolboy, teen, 15 years old, 16 years old, 17 years old |
| `violence_threat` — violence, menaces | tuer, frapper, cogner, poignarder, arme, flingue, couteau, braquage, je vais te retrouver | kill, stab, beat up, gun, knife, armed robbery, I will find you |
| `scam` — arnaque, argent | virement, western union, mandat cash, carte cadeau, code pcs, bitcoin, crypto, investissement, paypal, prêt d'argent | wire transfer, western union, gift card, bitcoin, crypto, investment, paypal, send money, loan |
| `sexual_content` — contenu sexuel | nude, nudes, sexe, plan cul, escort, tarif, onlyfans, mym | nudes, sex, hookup, escort, rates, onlyfans |
| `other` — drogues | cocaïne, coke, héroïne, crack, ecstasy, mdma, shit, beuh, dealer, deal | cocaine, coke, heroin, crack, ecstasy, mdma, weed, dealer |
| `other` — vrais délits graves | viol, violeur, séquestration, prison ferme, condamné pour | rape, rapist, kidnapping, convicted of |
| `other` — réseaux et sortie du site | snap, snapchat, insta, instagram, whatsapp, telegram, tiktok | snap, snapchat, insta, instagram, whatsapp, telegram, tiktok |
| `harassment` — insultes et haine | [À COMPLÉTER par la modération : insultes et termes haineux, FR et EN] | [À COMPLÉTER] |

## Points à trancher à la relecture
- **Faux positifs attendus** : « coke » (boisson), « deal », « tarif », « arme » (« l'arme fatale »), « couteau » (Casier : « A appris à jongler avec des couteaux »), « 16 ans » (« fan de rock depuis mes 16 ans »). Ils ne bloquent rien : ils remplissent la file de la modération. Les garder pour l'ouverture, puis retirer ceux qui ne servent qu'à faire du bruit ?
- **Réseaux sociaux** : signaler les pseudos de réseaux (« mon insta ») vise les sorties du site avant la confiance (SPEC §10). Les mots seuls (« Instagram ») sont aussi des centres d'intérêt : à garder ?
- **Ton du Casier** : le Casier joue sur l'univers carcéral ; « prison », « menottes », « évadé » ne sont pas listés exprès (ils font partie du jeu).
