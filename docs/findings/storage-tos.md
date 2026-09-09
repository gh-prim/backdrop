# CGU du fournisseur de stockage objet et contenu adulte

> Tâche phase 0 du spec (section 10 et 12). Statut: **tranché**.
> Vérifié le 9 septembre 2026. À revérifier avant toute mise en production
> durable, les CGU changent sans préavis.

## Question

Peut-on déposer les Variants de Backdrop sur Cloudflare R2 sans risquer une
suspension de compte pour contenu adulte, et quel est le repli si non ?

## Réponse courte

Oui pour l'usage prévu, et le risque est structurellement faible parce que
**R2 ne reçoit jamais de contenu NSFW** (spec section 5): seuls les Variants
SFW destinés à Instagram y transitent, précisément parce que Meta exige une
URL publique. Le contenu NSFW reste sur le volume local et dans Telegram et
Fanvue, qui reçoivent les octets directement depuis le worker.

Autrement dit, la question des CGU sur le contenu adulte porte sur des
fichiers qui, par construction, n'en sont pas.

## Ce que disent les documents

**Cloudflare.** Les [Terms of Use](https://www.cloudflare.com/website-terms/)
génériques ne couvrent pas R2: ils excluent explicitement les services sous
abonnement. Le document applicable est le
[Developer Platform Service-Specific Terms](https://www.cloudflare.com/service-specific-terms-developer-platform/),
dont la section 8 traite le contenu stocké.

La définition du contenu interdit y est **fermée et énumérative**: exploitation
sexuelle d'enfants et traite d'êtres humains, violation de propriété
intellectuelle ou contenu illégal, divulgation de données personnelles
sensibles, incitation à la violence, fraude, distribution de malware ou abus
technique.

**Le contenu adulte licite et consenti n'y figure pas.** Il n'existe pas non
plus de restriction sur le volume de fichiers non-HTML servis, contrairement à
la vieille clause de l'AUP CDN que l'on cite souvent de mémoire.

**Backblaze B2**, retenu comme repli, suit la même logique dans son
[Acceptable Use Policy](https://www.backblaze.com/company/policy/acceptable-use-policy):
interdiction du CSAM et de la diffusion d'imagerie intime non consentie, pas
d'interdiction générale du contenu adulte licite.

## Décision

1. **R2 est retenu**, avec l'interface S3, conformément à la section 6.
2. **La règle de la section 5 devient le vrai garde-fou juridique**, pas
   seulement technique: aucun Asset dont le rating dépasse SFW ne reçoit de clé
   R2. Le trigger de rating en base et la séparation des emplacements de
   stockage sont ce qui rend la conformité vérifiable plutôt que déclarative.
3. **Backblaze B2 reste le repli**, l'interface S3 étant identique: un
   changement de fournisseur se réduit à changer quatre variables
   d'environnement.
4. Ne jamais déposer sur R2 un fichier autrement que par le workflow
   `ingestVariant`, seul endroit qui connaît le rating.

## Limites de cette vérification

- Lecture des CGU publiques, sans échange avec le support Cloudflare. Pour un
  usage à fort volume ou revendu, une confirmation écrite serait justifiée.
- Le compte reste soumis à la clause de jugement discrétionnaire
  (« in our sole judgment »). La séparation SFW/NSFW réduit l'exposition, elle
  ne l'annule pas.
- Le contenu est généré, pas photographié: aucune question de consentement de
  personne réelle ne se pose, mais la conformité aux règles de chaque
  plateforme de diffusion reste un sujet distinct, traité par le `maxRating`
  de chaque ChannelAccount.
