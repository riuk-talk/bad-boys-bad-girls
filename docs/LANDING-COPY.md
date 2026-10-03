# Page d'accueil — texte validé par le porteur (2026-10-04)

> À appliquer **mot pour mot** dans `messages/fr.json` (section `Landing`), puis traduire en anglais dans `messages/en.json`. Les clés sont celles déjà utilisées par `app/[locale]/(public)/page.tsx`. Ne change pas la structure de la page, seulement les textes.

## Correction de concept (à appliquer partout : SPEC, CLAUDE.md, interface, e-mails)

1. **Le Parloir est le lieu où l'on discute. Ce n'est pas un lieu de « libération ».**
   - Le terme **« Libération » est retiré** de toute l'interface et des documents.
   - Quand, après une visite, les deux veulent continuer : **le Permis devient permanent** (« Permis permanent ») → le Parloir reste ouvert entre eux, sans horaire, et la Cavale devient possible.
   - Nom technique inchangé (`visits.outcome = 'released'`), seul le vocabulaire visible change. Tampon « LIBÉRÉ·E » remplacé par « PERMIS PERMANENT ».
2. **Le Casier = 3 chefs d'accusation : 1 vrai et 2 faux.** Le mot « aveux » est retiré (un faux n'est pas un aveu) : on dit toujours « chefs d'accusation ».
3. Le mot « match » reste interdit, y compris pour dire qu'il n'y en a pas.

## Textes (`Landing`)

| Clé | Texte |
|---|---|
| heroEyebrow | Site de rencontre · 18+ |
| heroTitle | Pour ceux qu'on a toujours trouvés trop. |
| heroLead | Ici, les Bads se mettent en vitrine et les Visiteurs viennent les voir. Pas de photos qu'on fait défiler à l'infini : une demande de visite, un pari sur un Casier, et une vraie conversation au Parloir. |
| door_bad | Je suis Bad |
| doorHint_bad | Je me mets en vitrine, je reçois des visites |
| door_visitor | Je viens visiter |
| doorHint_visitor | Je cherche un bad boy ou une bad girl |
| heroCtaLogin | J'ai déjà un compte |
| stepsTitle | Deux rôles, zéro baratin |
| stepsTitle_bad | Côté Bad |
| steps_bad[0] | **Ouvre ton Dossier** — Ta photo sur la toise, tes signes distinctifs et ton Casier : trois chefs d'accusation, un vrai et deux faux. |
| steps_bad[1] | **Le Juge, c'est toi** — Les Visiteurs demandent une visite. Tu lis leur Permis et tu décides : visite acceptée ou affaire classée. |
| steps_bad[2] | **Le Parloir** — Tu fixes tes Heures de visite. Au Parloir, vous discutez trente minutes en direct. Si vous voulez tous les deux continuer, le Permis devient permanent. |
| stepsTitle_visitor | Côté Visiteur |
| steps_visitor[0] | **Prends ton Permis** — Une photo, ton Motif de visite et dix questions. Le Greffe valide ta photo et te délivre ton Permis. |
| steps_visitor[1] | **Demande une visite** — Un Bad te plaît ? Lis son Casier et parie sur le chef d'accusation que tu crois vrai. Juste ou faux, ta demande part : ton pari reste secret jusqu'à la visite. |
| steps_visitor[2] | **Le Parloir** — Choisis une des Heures de visite proposées. La conversation s'ouvre sur ton pari, révélé à vous deux : personne n'a à écrire le premier message. |
| judgeTitle | Ici, c'est toi le juge. |
| judgeBody | Côté Bad, c'est toi qui décides. Chaque demande de visite arrive avec le Permis du Visiteur : tu acceptes ou tu classes l'affaire. |
| judgePoints[0] | Personne ne te parle au Parloir sans que tu aies accepté sa visite. |
| judgePoints[1] | Tu choisis combien de demandes peuvent t'attendre en même temps. Au-delà, ton Parloir affiche complet. |
| judgePoints[2] | Classer une affaire envoie un message neutre et respectueux : jamais de silence, jamais de justification. |
| judgePoints[3] | Après une visite, rien ne continue sans l'accord des deux. |
| promenadeTitle | La Promenade |
| promenadeBody | Chaque soir à 21 h, cinq Bads sortent dans la cour pour chaque Visiteur, choisis selon vos réponses au questionnaire. Une sélection, pas un catalogue sans fin. |
| quartersTitle | Les Bads d'abord |
| quartersBody | Un site de rencontre vide ne sert à rien. On ouvre quartier par quartier, en commençant par le Var et les Alpes-Maritimes. Les Bads s'inscrivent en premier ; les Visiteurs prennent leur Permis et suivent la jauge de leur quartier. Les visites ouvrent quand il y a assez de Bads. |
| charterTitle | Bad, pas toxique. |
| charterLead | « Bad », c'est une attitude et une esthétique. Jamais une excuse. |
| charterPoints | La franchise, oui. Le mépris, non. / L'audace, oui. L'insistance, non. / La liberté, oui. Le contrôle, non. |
| charterLink | Lire la Charte |
| finalTitle | Coupables de charme… |
| finalBody | Ton Dossier ou ton Permis t'attend. |

## Vérification demandée
Après application, relis **toute** l'interface (landing, onboarding, Ma Fiche / Mon Permis, Charte, CGU, pages d'aide, e-mails, vitrine /design) et liste-moi chaque texte qui contredit ces règles : Libération, aveux, Plaidoirie, Audience du soir, Réglo, « deviner le faux », « match ».
