# Backdrop — Spécification

> Statut: draft initial.
> Ce document est la source de vérité pour l'implémentation. Toute décision qui le contredit doit être remontée avant d'être codée.

---

## 1. Intent

Je veux un outil interne unique pour administrer plusieurs influenceurs virtuels à la fois, en remplacement du travail manuel actuel réparti entre l'app Instagram, Telegram et Fanvue.

Le geste central du produit: je uploade un média une fois, je choisis sur quels canaux il part, l'outil dérive les formats et les textes, programme les publications, et me remonte ce que ça a rapporté. Et je passe d'un influenceur à l'autre en un clic.

Ce n'est pas un produit destiné à être vendu à court terme. C'est un outil d'équipe, optimisé pour la vitesse d'exécution des opérateurs qui l'utilisent. Toute complexité qui ne sert pas ça est à écarter.

**L'outil est multi-utilisateur.** Plusieurs opérateurs partagent la même Organization et travaillent sur le même portefeuille de personas. L'authentification est locale (email et mot de passe) via Better Auth, sans fournisseur externe pour le moment. Conséquence directe: toute action ayant un effet externe est attribuée à son auteur, et les credentials plateforme ne sont jamais exposés aux utilisateurs, quel que soit leur rôle.

**Contrainte de temps: 5 à 15 heures par semaine.** Le phasage du plan (section 12) n'est pas indicatif, il est structurant.

---

## 2. Objectifs

1. Réduire le temps de publication récurrente d'un facteur 5 au minimum.
2. Rendre impossible l'erreur qui coûte le plus cher: publier du contenu NSFW sur un compte Instagram.
3. Savoir, par persona et par média, ce qui a rapporté de l'argent.
4. Absorber l'ajout d'une nouvelle persona sans travail d'infrastructure.

### Non-objectifs (explicitement hors périmètre)

- **Toute automatisation de follow, unfollow ou like sur Instagram.** L'API ne l'expose pas, et les contournements mettent en jeu l'actif principal. Décision arrêtée, ne pas rouvrir sans discussion.
- **Toute génération de contenu.** L'outil ingère des fichiers finis, il ne les produit pas.
- **Les stories Instagram.** Hors périmètre entièrement. L'API ne permet ni sticker, ni sondage, ni musique, ni lien: une story publiée par API est un visuel plat sans interactivité, donc sans intérêt sur les métriques qui comptent. Les stories restent manuelles.
- **L'authentification fédérée.** Pas d'OAuth, pas de SSO, pas de magic link. Email et mot de passe uniquement, à ce stade.
- **Les permissions fines par persona.** Voir section 10: la question est ouverte, mais la phase 1 livre un modèle à deux rôles seulement.
- **L'inbox unifiée (DM Instagram, Telegram, Fanvue).** Reportée, à réévaluer quand le volume de messages devient le goulot.

---

## 3. Concepts

| Concept | Définition |
|---|---|
| **Organization** | Le tenant. L'équipe d'opérateurs et son portefeuille de personas. Frontière d'isolation et d'authentification. |
| **User** | Un opérateur. Appartient à une ou plusieurs Organizations via un Member. |
| **Member** | Le rattachement d'un User à une Organization, porteur du rôle. |
| **Persona** | Un influenceur virtuel. Unité de *scope*, pas d'isolation. Le dashboard global traverse les personas. |
| **ChannelAccount** | Le rattachement d'une persona à un canal (Instagram, Telegram, Fanvue) avec ses credentials et ses quotas. |
| **Asset** | Le média master, tel qu'uploadé. Porte un rating immuable. |
| **Variant** | Un rendu dérivé d'un Asset pour un format donné (ratio, watermark, flou, résolution). |
| **Publication** | Une tentative de publication d'un Variant sur un ChannelAccount, avec son texte, son horaire et son cycle de vie propre. |
| **DmCampaign** | Un envoi en masse vers les DM Telegram d'une persona. Distinct d'une Publication, car un destinataire = un envoi. **Telegram uniquement**: sur Fanvue, le fan-out est fait par la plateforme et l'envoi de masse est une Publication (4.3.10). |

**Règle d'or de la modélisation:** une Publication qui échoue ne fait jamais tomber ses sœurs. Chaque canal a son propre état.

---

## 4. Contraintes plateformes

Cette section est le fruit d'une recherche déjà faite. **Ne pas la re-dériver, ne pas la contourner.**

### 4.1 Instagram

Accès via l'**Instagram API with Facebook Login** (pas Instagram Login, voir 4.1.5).

**4.1.1 Prérequis de compte.** Chaque persona a besoin d'un compte Instagram Business lié à une Page Facebook. Les Pages sont regroupées sous un Business Manager unique.

**4.1.2 Pas d'App Review.** L'app Meta reste en mode développement, ce qui débloque `instagram_content_publish` sans passer de review. Concevoir pour rester dans ce mode.

Le mécanisme n'est **pas** la liste « Instagram Tester » du tableau de bord: celle-ci appartient à l'Instagram Basic Display et à Instagram Login, où le compte Instagram autorise l'app directement. Avec Facebook Login, ce qui compte est que le **profil Facebook** porteur du jeton ait un rôle sur l'app (administrateur, développeur ou testeur) **et** puisse effectuer des tâches sur la Page liée au compte Instagram. Chercher son compte Instagram dans la liste des testeurs est une impasse: il n'y apparaîtra pas.

**4.1.3 Publication en deux temps.**
```
POST /{ig-user-id}/media          → creation_id
GET  /{creation-id}?fields=status_code   → IN_PROGRESS | FINISHED | ERROR
POST /{ig-user-id}/media_publish  → media_id
```
Le polling est obligatoire pour les vidéos et reels. Ne jamais publier dans la foulée de la création du container.

**4.1.4 Types supportés: image simple, carrousel, Reel. Rien d'autre.**

Le carrousel a un flux à trois temps, différent du post simple:
```
POST /{ig-user-id}/media          is_carousel_item=true, image_url|video_url   → child_id  (xN)
POST /{ig-user-id}/media          media_type=CAROUSEL, children=<id1,id2,...>, caption  → creation_id
POST /{ig-user-id}/media_publish  creation_id
```
- Jusqu'à 10 éléments, images et vidéos mélangeables.
- La légende est portée par le container parent, pas par les enfants.
- Un carrousel compte pour **une seule** publication dans le quota des 100 par 24 h.
- Les containers enfants sont créés en parallèle mais doivent tous être `FINISHED` avant la création du parent.

Pour un Reel: `media_type=REELS` avec `video_url`. REELS n'est pas un vrai media type: après publication, `media_type` renvoie VIDEO. Utiliser `media_product_type` pour distinguer.

**4.1.5 Musique sur les Reels.** L'Instagram Audio API permet d'attacher une piste native du catalogue Instagram, mais **uniquement sur les Reels** et **uniquement via Facebook Login**.
```
GET  /ig_audio?audio_type=music&user_id={id}&search_query=...
POST /{ig-user-id}/media
     media_type=REELS
     video_url=...
     audio_configuration={"audio_id":"...","audio_volume":80,"video_volume":40}
```
Le catalogue exposé par l'API est plus restreint que celui de l'app mobile. Aucune prévisualisation possible: ce qui est configuré part en production tel quel. Prévoir un compte de test.

**4.1.6 Hébergement média.** Meta fait un `cURL` sur `image_url` / `video_url` au moment de la publication. Le fichier doit être sur une URL publique accessible à cet instant.

**4.1.7 Specs vidéo.** MP4 ou MOV, H264 ou HEVC, audio AAC 48 kHz, `moov` atom en début de fichier (`ffmpeg -movflags +faststart`). Un fichier non conforme échoue au stade container, souvent sans message clair.

**4.1.8 Quotas.** Interroger `GET /{ig-user-id}/content_publishing_limit` avant chaque publication plutôt que d'encaisser l'erreur 9.

Le plafond lui-même **ne se code pas en dur**: ce spec annonçait 100 par fenêtre glissante de 24 h, la documentation Meta en annonce 50 depuis le passage à l'Instagram Platform. Le nombre a déjà changé une fois, il changera encore. L'adapter lit `quota_total` dans la réponse et ne garde 50 que comme valeur de repli si le champ manque. Un carrousel compte toujours pour une seule publication.

**4.1.9 Tokens.** Le long-lived token expire à 60 jours. Un job de refresh est obligatoire, sinon la pipeline meurt silencieusement.

**4.1.10 Ce que l'API ne donne pas.** Pas de follow ni d'unfollow. Pas de liste de followers (seulement `followers_count` et des démographies agrégées). Pas d'accès aux stories d'autrui.

### 4.2 Telegram

Accès via **MTProto en session utilisateur** avec Hydrogram. Pas de bot: une persona doit pouvoir initier une conversation et ne pas afficher de badge bot.

**4.2.1 Authentification.** Un seul `api_id` / `api_hash` pour toute l'application. Une string session par persona, stockée chiffrée en base.

**4.2.2 Unicité de session.** Deux processus utilisant la même session en parallèle déclenchent `AUTH_KEY_DUPLICATED` et **détruisent la session**. Conséquence architecturale contraignante, voir 7.3.

**4.2.3 Fingerprint stable.** `device_model`, `system_version` et `app_version` sont passés explicitement au client et stockés en base à côté de la session. Ils ne doivent jamais changer sur la durée de vie d'une session. Ne pas laisser Hydrogram prendre ses valeurs par défaut, qui dérivent avec les versions de Python.

**4.2.4 Paid media.** Pas de méthode haut niveau dans Hydrogram. Passage obligatoire par le raw:
```python
await app.invoke(raw.functions.messages.SendMedia(
    peer=await app.resolve_peer(chat_id),
    media=raw.types.InputMediaPaidMedia(
        stars_amount=50,
        extended_media=[reusable_input_media],
    ),
    message=caption,
    random_id=app.rnd_id(),
))
```

**4.2.5 Attribution perdue.** Le champ `payload` de `inputMediaPaidMedia` et l'update `updateBotPurchasedPaidMedia` sont marqués **bots only**. En session utilisateur, il n'y a pas d'attribution par achat. Réconciliation par fenêtre temporelle uniquement, ce qui impose de ne pas publier deux médias payants le même jour sur le même channel si on veut des chiffres exploitables. **Contrainte éditoriale, pas seulement technique.**

**4.2.6 Paid media en DM: à valider avant tout développement.** Toute la documentation MTProto décrit le paid media comme une fonctionnalité de channel. L'ouverture "to any chat" est documentée côté Bot API et suppose un solde de bot, qui n'a pas d'équivalent pour un compte utilisateur. L'app officielle ne propose pas de média payant en conversation privée.
  - **Tâche bloquante, phase 0.** Tester `SendMedia` + `InputMediaPaidMedia` vers un `InputPeerUser` et consigner l'erreur exacte.
  - **Si ça échoue:** le DM devient relationnel et l'upsell se fait par lien Fanvue. Un seul rail de paiement Telegram (le channel). C'est le scénario de repli attendu, et il est acceptable.

**4.2.7 Upload en deux temps.** MTProto ne connaît pas l'upload par URL. Le worker télécharge depuis le disque local et remonte les octets.
```python
input_file = await app.save_file(path)                    # découpage, parts, big file
uploaded   = raw.types.InputMediaUploadedDocument(...)     # + DocumentAttributeVideo + thumb
result     = await app.invoke(raw.functions.messages.UploadMedia(
                 peer=raw.types.InputPeerSelf(), media=uploaded))
reusable   = raw.types.InputMediaDocument(id=raw.types.InputDocument(
                 id=..., access_hash=..., file_reference=...))
```
Le `reusable` est l'équivalent MTProto du `file_id` de la Bot API: uploader une fois, envoyer N fois. Sur un blast de 500 DM, la différence est de plusieurs ordres de grandeur.

**4.2.8 `file_reference` expire.** En quelques heures. Ne jamais le persister comme durable. Le pattern retenu: uploader dans les **Saved Messages** de la persona, stocker le `message_id`, et régénérer une référence fraîche via `messages.GetMessages` en tête de chaque workflow.

**4.2.9 Vidéos.** `DocumentAttributeVideo(duration, w, h, supports_streaming=True)` et un thumb explicite sont obligatoires. Sans ça, la vidéo part en pièce jointe générique, ce qui est rédhibitoire sur un média payant vendu sur la seule foi de sa vignette.

**4.2.10 Rate limiting.** `FLOOD_WAIT_X` donne le délai à respecter: c'est un état, pas une erreur, et le backoff est dicté par le serveur, pas par la retry policy. `PEER_FLOOD` en revanche n'est pas un retry: arrêt de tout envoi sur la persona et alerte.

### 4.3 Fanvue

Accès via l'**API REST v1**, `https://api.fanvue.com/v1`, spécification OpenAPI 3.1 publique. Contrairement à Instagram et Telegram, tout ce dont l'outil a besoin est exposé de première main: upload de média, post payant, message unitaire, message de masse segmenté, et revenus **attribués au post ou au message**. C'est le canal le moins contraint des trois; les contraintes qui restent sont d'authentification et d'idempotence.

**4.3.1 En-tête de version obligatoire.** `X-Fanvue-API-Version: 2025-06-26` sur **chaque** requête. Absente ou inconnue: 400. Version retirée: 410 avec un champ `nextVersion`. Le préfixe `/v1` est un second axe de version, indépendant de l'en-tête. Les deux sont épinglés en constantes dans l'adapter, jamais recopiés ailleurs.

**4.3.2 OAuth 2.0 avec PKCE, pas de clé d'API.**
```
GET  https://auth.fanvue.com/oauth2/auth    client_id, redirect_uri, scope, state, code_challenge
POST https://auth.fanvue.com/oauth2/token   Basic(client_id:client_secret), code, code_verifier
```
L'app est créée dans le Fanvue Builder (type *off-platform*) pour obtenir `client_id` et `client_secret`. Aucune soumission à l'App Store n'est nécessaire pour un usage interne, à confirmer au moment de la création du compte.

Conséquence produit: connecter un ChannelAccount Fanvue est un **flux interactif** réservé au rôle `owner`, pas un collage de token dans un formulaire. Le `redirect_uri` doit être une URL HTTPS atteignable au moment de l'autorisation.

Scopes retenus: `offline_access read:self read:media write:media read:post write:post read:chat write:chat read:insights`. `offline_access` est ce qui débloque le refresh token: sans lui, la connexion meurt au bout d'une heure.

**4.3.3 Rotation du refresh token: contrainte de concurrence.** L'access token vaut ~1 h. Le refresh token est **à usage unique**: chaque échange en renvoie un nouveau qui doit écraser l'ancien immédiatement. Une fenêtre de grâce de 30 s absorbe les retries; au-delà, réutiliser un refresh token consommé **invalide toute la chaîne** et impose une réautorisation manuelle de la persona.

Conséquence architecturale: le refresh est **sérialisé par ChannelAccount** (advisory lock Postgres ou `SELECT … FOR UPDATE` sur la ligne), et le nouveau token est persisté avant tout autre appel. C'est le pendant Fanvue de la contrainte de session Telegram (4.2.2): deux workers qui rafraîchissent le même compte en parallèle le cassent. Ne jamais placer un refresh dans une activité Temporal réessayable sans ce verrou.

**4.3.4 Quotas.** 200 requêtes par 60 s, bucket keyé `clientId : userUuid [ : creatorUserUuid ]`. Les endpoints creator-scoped (`/v1/creators/{uuid}/…`) ont donc un bucket **indépendant par créatrice**, alors que les endpoints personnels et `/v1/agencies/*` partagent un seul bucket. 429 renvoie `Retry-After` et `X-RateLimit-Reset`: le backoff est dicté par le serveur, comme `FLOOD_WAIT` en 4.2.10.

**4.3.5 Upload média en trois temps.** Multipart S3, les octets partent du worker.
```
POST  /v1/media/uploads                          name, filename, mediaType, sizeBytes
        → { mediaUuid, uploadId, partSize, maxParts, totalParts }
GET   /v1/media/uploads/{uploadId}/parts/{n}/url → URL signée (text/plain), une par part
PUT   <URL signée>                                les octets de la part, récupérer l'ETag
PATCH /v1/media/uploads/{uploadId}                parts: [{ PartNumber, ETag }]   (casse S3, pas camelCase)
```
`mediaType` ∈ `image | video | audio | document`. Taille maximale 1 610 612 736 octets (1,5 Gio). Si `sizeBytes` est fourni, la réponse donne `totalParts` exact; sinon le worker calcule `ceil(taille / partSize)`.

Après le `PATCH`, le média passe en `processing` puis `ready` (`created | processing | ready | error`). Tant qu'il n'est pas final, `GET /v1/media/{uuid}` ne renvoie que `uuid` et `status`. Polling obligatoire avant d'attacher le média, exactement comme le `status_code` d'Instagram en 4.1.3. La doc n'énonce pas explicitement le rejet d'un média non prêt à la création d'un post: attendre `ready` de toute façon, et consigner le comportement réel au premier essai. Noter aussi que la documentation mélange les vocabulaires `ready` et `FINALISED` pour le même état.

Comme Telegram et contrairement à Instagram, aucune URL publique n'est nécessaire: **rien ne passe par R2 pour Fanvue**. Le garde-fou de la section 5 reste intact.

**4.3.6 Variants et URLs signées.** `GET /v1/media/{uuid}?variants=main,thumbnail,blurred`. **Sans le paramètre `variants`, la réponse ne contient aucune URL.** Les URLs sont signées et de courte durée: elles se redemandent, elles ne se persistent pas. Le variant `blurred` est produit par Fanvue et n'a rien à voir avec le teaser flouté dérivé côté Backdrop (phase 3), qui reste nécessaire pour Instagram et Telegram.

**4.3.7 Post.**
```
POST /v1/posts
  audience         subscribers | followers-and-subscribers      (obligatoire)
  text             ≤ 5000 caractères
  mediaUuids       []
  price            cents USD, minimum 300, exige des médias
  mediaPreviewUuid média affiché gratuitement avant déverrouillage
  publishAt        ISO 8601, publication différée côté Fanvue
  expiresAt        ISO 8601, expiration du post
  collectionUuids  []
```
Le couple `price` + `mediaPreviewUuid` est le rail de monétisation natif: un post payant avec son teaser gratuit. Il correspond exactement au geste "master NSFW + teaser flouté" de la phase 3, sans avoir à publier deux objets.

**4.3.8 Programmation: pas de délégation.** `publishAt` et `scheduledAt` permettraient de déposer l'objet chez Fanvue et de laisser la plateforme le publier. **On ne s'en sert pas:** l'horloge est tenue par l'application sur tous les canaux, voir 7.6. Ces champs sont documentés ici pour qu'ils ne soient pas redécouverts comme une bonne idée dans six mois.

**4.3.9 Aucune idempotence sur la création de post.** Pas d'en-tête d'idempotency. Un timeout réseau après un POST déjà traité produit un doublon au retry. `workflowId = publication.id` (7.2) protège du double déclenchement de workflow, **pas** du double POST à l'intérieur d'une activité réessayée.

Règle: avant de rejouer un POST, l'activité relit `GET /v1/posts` sur une fenêtre récente et cherche le post correspondant; le `uuid` retourné est persisté dans la même transaction que le passage en `PUBLISHED`. Seul `POST /v1/media/{uuid}/grant` est idempotent par conception (couple `source` + `sourceRef`), et l'outil ne s'en sert pas à ce stade.

**4.3.10 Messages et envois de masse.**
```
POST /v1/chats/{userUuid}/message   text, mediaUuids, mediaPreviewUuid, price (≥ 300), gif
POST /v1/chats/mass-messages        text, mediaUuids, mediaPreviewUuid, price (≥ 300),
                                    includedLists / excludedLists, scheduledAt
```
Les listes intelligentes sont des identifiants fixes, pas des UUID: `subscribers`, `auto_renewing`, `non_renewing`, `followers`, `free_trial_subscribers`, `expired_subscribers`, `spent_more_than_50`, `muted`, `creators`. Les listes personnalisées s'y ajoutent par UUID.

**Conséquence de modélisation, importante.** Un envoi de masse Fanvue est **un seul appel**: la segmentation et le fan-out sont côté Fanvue. Il ne se modélise donc **pas** comme `DmCampaign` + `DmDelivery`, structure imposée par MTProto où un destinataire égale un envoi (4.2.7). Une campagne Fanvue est une `Publication` de kind `FV_MASS_DM`, avec son `remoteId` et rien d'autre. Ne pas généraliser le modèle Telegram à Fanvue: ce serait reconstruire à la main un fan-out déjà fourni, avec les quotas en prime.

**4.3.11 Revenus attribués au média.** `GET /v1/insights/earnings` (pagination par curseur, paramètre de taille `size`, pas `limit`) renvoie une ligne par transaction:
`date`, `gross`, `net` (cents USD, déjà convertis, `currency` n'est qu'informatif), `source`, `transactionOrderId`, `transactionOrderStatus` (`pendingBalance | availableForPayout`), **`postUuid`**, **`messageUuid`**, et `reversedTransactionOrderId` sur les lignes de reversal.

`source` ∈ `subscription | renewal | post | message | tip | mediaLink | checkoutLink | fanExperience | affiliate | referral | giveaway | appStore | refund | chargeback`. `renewal` absorbe tous les paiements récurrents à partir du deuxième: `subscription` ne contient que les premiers paiements.

Un remboursement ou un chargeback est **toujours une ligne propre à montant négatif**, jamais une réécriture de la transaction d'origine.

**C'est l'inverse exact de Telegram (4.2.5): l'attribution par média est native.** L'objectif 3 est donc pleinement atteignable sur Fanvue et sur Instagram, et reste dégradé sur le seul canal Telegram. La contrainte éditoriale de 4.2.5 (un seul média payant par jour et par channel) ne s'applique pas à Fanvue.

Les lignes de revenu sont transactionnelles et mutables (`pendingBalance` → `availableForPayout`): elles ne se rangent pas dans `MetricSnapshot`, qui est un instantané. D'où le modèle `FanvueEarning` de la section 8, en upsert sur `transactionOrderId`.

**4.3.12 Webhooks: pas maintenant.** Fanvue expose des webhooks temps réel (`creator.payment.succeeded`, `subscription.*`, `creator.message.received`, etc.) et décourage explicitement le polling. Mais une souscription exige une **URL HTTPS publique, sans redirection ni localhost**, ce que le déploiement Docker Compose auto-hébergé n'a pas.

Décision: phase 4 en polling quotidien de `/v1/insights/earnings`, borné par `startDate` et `endDate`, dans `collectInsights`. Les webhooks sont la voie de sortie le jour où un ingress public existe. Ne pas en monter un pour ça.

**4.3.13 Compte simple ou agence.** Chaque endpoint existe en double: personnel (`/v1/posts`) et creator-scoped (`/v1/creators/{creatorUserUuid}/posts`). Si les personas sont regroupées sous une agence Fanvue, **une seule autorisation OAuth** couvre tout le portefeuille, avec un bucket de quota par créatrice. Sinon, une autorisation par persona. Le choix change le nombre de ChannelAccount à connecter et la forme de l'adapter. Voir section 10.

**4.3.14 Ce que l'API ne donne pas.** Pas d'idempotency key sur les écritures (4.3.9). Pas d'identifiant de média sur les lignes de revenu: l'attribution s'arrête au post ou au message. Pas d'URL média durable: uniquement des URLs signées à redemander.

---

## 5. Stockage

Trois emplacements, trois rôles distincts. C'est aussi un garde-fou de sécurité.

| Emplacement | Contenu | Exposition |
|---|---|---|
| **Volume local** | Tous les Assets et Variants. Source de vérité. | Aucune. Jamais servi sur le réseau. |
| **Cloudflare R2** | Uniquement les Variants SFW destinés à Instagram. | URL publique, obligatoire pour le `cURL` de Meta. Purgeable après publication. |
| **Telegram Saved Messages** | Les Variants poussés vers Telegram. | Interne à Telegram. Sert de CDN et de référence réutilisable. |
| **Vault Fanvue** | Les Variants poussés vers Fanvue. | Interne à Fanvue. URLs signées de courte durée, jamais persistées. |

**Pourquoi rien d'exposé pour Telegram ni pour Fanvue:** MTProto (4.2.7) et l'upload multipart Fanvue (4.3.5) poussent tous deux les octets depuis le worker. Aucun fetch serveur, donc aucune surface publique nécessaire. **Instagram est la seule plateforme qui exige une URL publique**, et c'est précisément pourquoi R2 ne reçoit que du SFW. Ne pas monter de serveur de fichiers.

**Le split R2 est le second garde-fou anti-NSFW.** Un Asset NSFW n'a physiquement pas d'URL publique à fournir à Meta, même en cas de bug applicatif. Vérifier les CGU du fournisseur de stockage objet sur le contenu adulte avant d'y déposer quoi que ce soit; prévoir Backblaze B2 en repli, l'interface S3 étant identique.

---

## 6. Stack

| Couche | Choix |
|---|---|
| Web | Next.js (App Router), TypeScript |
| UI | Tailwind, shadcn/ui sur primitives Radix, dark mode |
| Icônes | lucide-react |
| Formulaires | react-hook-form + zod |
| Tables | TanStack Table |
| Auth | Better Auth, plugin organization |
| ORM | Prisma 6 (épinglé, voir 6.2) |
| Base | PostgreSQL |
| Orchestration | Temporal |
| Worker principal | Node / TypeScript (Instagram, ffmpeg, R2, Fanvue) |
| Worker Telegram | Python / Hydrogram |
| Objet | Cloudflare R2 (interface S3) |
| Média | ffmpeg |
| Déploiement | Docker Compose |

**Note sur le bi-langage.** Hydrogram impose un worker Python à côté du worker Node. C'est un coût assumé: deuxième image, deuxième SDK Temporal, contrat de données à maintenir entre les deux. La contrepartie est la maturité d'Hydrogram sur MTProto et l'expérience déjà acquise avec. Le worker Python ne parle **pas** à Prisma: il reçoit ses entrées et renvoie ses sorties via les activités Temporal, sérialisées en JSON. Toute écriture en base passe par le worker Node.

### 6.1 Interface

**Dark mode uniquement.** Pas de thème clair, pas de sélecteur. Les tokens sont définis en variables CSS sous la classe `dark` appliquée sur `<html>`, ce qui laisse la porte ouverte à un thème clair plus tard sans refonte, mais il n'est pas construit et pas maintenu.

**shadcn/ui, composants copiés dans le repo** via le CLI, donc éditables et versionnés avec le reste. Corollaire: on modifie le composant local plutôt que de l'envelopper dans une surcouche. Pas d'autre bibliothèque de composants ajoutée par-dessus.

Le CLI livre désormais des primitives **Base UI**, pas Radix: shadcn a migré, et c'est la même équipe derrière les deux. Conséquence pratique dans le code: `render={<Composant />}` remplace `asChild`, `onClick` remplace `onSelect` sur les items de menu, et un `Label` de menu doit être enveloppé dans un `Group`. La propriété qui comptait pour ce choix, des composants vendorisés et modifiables, est intacte.

**Police: Lato**, chargée via `next/font/google`, exposée en `--font-lato` et branchée sur les tokens `--font-sans` et `--font-heading`.

**Densité d'outil, pas de site vitrine.** C'est une interface utilisée plusieurs fois par jour sur les mêmes gestes. Priorité à la compacité, aux raccourcis clavier sur les actions répétitives (changement de persona, nouvelle publication, programmation), et aux tables denses plutôt qu'aux cartes aérées.

**Sélecteur de persona persistant** dans le header, visible sur tous les écrans. C'est le geste le plus fréquent du produit.

**Traitement des médias dans l'UI.** L'outil est partagé entre plusieurs opérateurs et affiche du contenu NSFW.
- Les vignettes des Assets `NSFW` et `SUGGESTIVE` sont **floutées par défaut**, révélées au survol ou au clic, avec une préférence utilisateur pour désactiver le flou.
- Le `rating` est affiché en badge sur chaque Asset et chaque Variant, partout où ils apparaissent, sans exception.
- Dans le Composer, un canal dont le `maxRating` est inférieur au rating de l'Asset est **désactivé et expliqué**, pas simplement absent. C'est la troisième couche du garde-fou de la section 9, la couche pédagogique: l'opérateur doit comprendre pourquoi Instagram est grisé.

**Écrans**

| Écran | Contenu |
|---|---|
| Dashboard global | Toutes les personas côte à côte, publications à venir, échecs à traiter, publications manquées à trancher (7.6) |
| Persona | Vue d'une persona: canaux connectés et leur état, publications, stats |
| Library | Grille d'Assets et de Variants, filtres par rating et par canal de destination |
| Composer | Un ou plusieurs Assets, sélection des canaux, textes et prix par canal, programmation |
| Calendrier | Vue temporelle tous canaux, par persona ou globale |
| Réglages | Membres et invitations, ChannelAccount et leur état de connexion |

### 6.2 Versions épinglées et pourquoi

| Choix | Raison |
|---|---|
| **Prisma 6**, pas 7 | Prisma 7 déplace l'ORM vers un modèle « contract / Prisma Next » orienté plateforme, avec une CLI entièrement différente (`prisma contract`, `prisma migration plan`). Le schéma de la section 8 et l'adapter Prisma de Better Auth visent la génération 6. Migrer plus tard, délibérément, pas par accident d'installation. |
| **Next 16, React 19, Tailwind 4** | Versions courantes du scaffold. Rien n'en dépend de manière risquée. |
| **Base UI via shadcn** | Voir 6.1. Ce n'est pas un choix, c'est ce que le CLI livre. |

---

## 7. Architecture

### 7.1 Services Docker Compose

| Service | Rôle | Notes |
|---|---|---|
| `postgres` | Base applicative | Volume persistant |
| `postgres-temporal` | Base Temporal | Instance ou base séparée. Ne pas partager le schéma applicatif. |
| `temporal` | Serveur Temporal | Ne pas utiliser `auto-setup` hors développement, gérer les migrations explicitement |
| `temporal-ui` | Console | Indispensable au debug des workflows longs |
| `web` | Next.js | |
| `worker-node` | Activités TS | Scalable horizontalement |
| `worker-telegram` | Activités Python | **`replicas: 1` strictement** (voir 7.3) |

Volume nommé `media` monté sur `worker-node`, `worker-telegram` et `web` (lecture seule pour ce dernier).

### 7.2 Workflows Temporal

| Workflow | Déclencheur | Forme |
|---|---|---|
| `publishInstagram` | Publication programmée | containers enfants en parallèle si carrousel → polling de chaque `status_code` → container parent → publish → persistance du `remote_id` |
| `publishTelegramChannel` | Publication programmée | résolution du `file_reference` → `SendMedia` + `InputMediaPaidMedia` |
| `publishFanvue` | Publication programmée | attente du statut `ready` du média → relecture anti-doublon → `POST /v1/posts` ou `/v1/chats/mass-messages` → persistance du `uuid` |
| `runDmCampaign` | Campagne programmée | snapshot des destinataires → boucle throttlée → réconciliation |
| `ingestVariant` | Création d'un Variant | ffmpeg → local → R2 si SFW → upload Telegram → upload Fanvue → persistance des pointeurs |
| `refreshMetaTokens` | Schedule, tous les 45 jours | Refresh de tous les ChannelAccount Instagram, alerte sur échec |
| `refreshFanvueToken` | À la demande, avant tout appel expiré | Sérialisé par ChannelAccount (4.3.3). Écriture du nouveau refresh token avant tout autre appel. |
| `collectInsights` | Schedule, quotidien | Insights IG, compteurs Telegram, revenus Fanvue paginés par curseur et upsertés sur `transactionOrderId` |

**Idempotence:** `workflowId = publication.id` pour toute publication. Temporal refuse alors nativement le doublon. Un double post Instagram est signalé comme spam.

**Aucun credential ne traverse un workflow.** Les entrées et sorties d'activité sont écrites dans l'historique Temporal, donc persistées dans la base de Temporal. Un token Meta qui transite par un workflow est un token stocké en clair dans un second système, hors du périmètre chiffré de la section 9.2. Conséquence sur le découpage: **le workflow ne manipule que des identifiants**, et chaque activité qui a besoin d'un secret va le chercher elle-même en base. C'est ce qui explique la forme des activités, qui prennent un `channelAccountId` là où une signature naïve prendrait un token.

**Programmation:** le workflow est démarré à la programmation et dort jusqu'à l'échéance, aucune horloge n'est déléguée à une plateforme. Règle complète et tolérance de retard en 7.6.

**Contrainte de sandbox:** le code de workflow s'exécute dans un contexte déterministe sans `process` ni accès au système. Tout module qu'il importe doit donc être exempt de lecture d'environnement, d'où la séparation entre les constantes (`src/temporal/config.ts`, importable depuis un workflow) et la configuration (`src/temporal/env.ts`, qui ne l'est pas). Un `process.env` qui remonte par un import transitif ne casse pas la compilation, il casse l'activation du workflow à l'exécution.

### 7.3 Contrainte de session Telegram

Une session ne peut vivre que dans un seul processus. Le `worker-telegram` est donc un **singleton** qui détient un dictionnaire `persona_id → Client` et sert une task queue dédiée. `replicas: 1` est une contrainte de correction, pas de performance: la violer détruit les sessions.

Corollaire: le débit Telegram est plafonné par ce worker unique. Acceptable au volume visé. Si ça devient un goulot, la sortie est un worker par persona avec une task queue par persona, pas la réplication du worker actuel.

### 7.4 Multi-utilisateur

**Better Auth, plugin organization, authentification email et mot de passe.** Les tables du plugin (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`) sont générées par Better Auth et intégrées au schéma Prisma. Ne pas les réécrire à la main.

**Deux rôles à ce stade:**

| Rôle | Peut |
|---|---|
| `owner` | Tout, plus: inviter et retirer des membres, créer et supprimer des personas, configurer les ChannelAccount |
| `member` | Uploader, composer, programmer, publier, consulter les stats. Ne voit jamais les credentials plateforme. |

Pas de troisième rôle tant qu'un besoin réel ne l'impose pas.

**Isolation.** Chaque requête est scopée par l'`organizationId` de la session, jamais par un paramètre fourni par le client. Le sélecteur de persona filtre à l'intérieur de l'Organization, il n'est pas une frontière de sécurité: un `member` peut voir toutes les personas de son Organization.

**Attribution.** Toute entité produisant un effet externe porte un `createdByUserId`: Asset, Variant, Publication, DmCampaign. C'est indispensable dès qu'on est plusieurs sur les mêmes comptes: une publication ratée ou un mauvais prix en Stars doit pouvoir être remonté à son auteur sans enquête.

**Credentials.** Les tokens Meta, les string sessions Telegram et les tokens OAuth Fanvue ne sont jamais renvoyés au client, même partiellement, même pour un `owner`. L'UI affiche un état (`connecté`, `expire dans N jours`, `à reconnecter`) et rien d'autre. Les credentials ne transitent qu'entre la base et les workers. Seule exception de forme: la connexion OAuth Fanvue (4.3.2) est un aller-retour de navigateur initié par un `owner`; le code d'autorisation est échangé côté serveur et rien du token ne redescend au client.

**Concurrence.** Plusieurs opérateurs peuvent éditer la même Publication. Verrou optimiste par colonne `version` sur `Publication` et `DmCampaign`: une sauvegarde sur une version périmée est rejetée avec un message explicite plutôt que d'écraser silencieusement le travail d'un collègue.

### 7.5 Contrat d'adapter

Chaque plateforme implémente la même interface, les capacités étant déclarées en données et non en branchements conditionnels dispersés dans le code.

```ts
interface ChannelAdapter {
  capabilities(): ChannelCapabilities   // formats, ratios, longueur de texte, rating max
  checkQuota(account): Promise<QuotaStatus>
  publish(publication): Promise<{ remoteId: string }>
  fetchMetrics(publication): Promise<Metrics>
}
```

Aucun `if (platform === 'instagram')` en dehors des adapters.

### 7.6 Programmation

**Règle: l'horloge est tenue par l'application, sur tous les canaux, sans exception.** Temporal décide quand une `Publication` ou une `DmCampaign` part. Aucune programmation n'est déléguée à une plateforme, y compris quand la plateforme l'offre.

| Plateforme | Programmation native disponible | Décision |
|---|---|---|
| Instagram | Aucune. L'API publie au moment de l'appel. | Sans objet. |
| Telegram | `schedule_date` sur `messages.SendMedia`. Comportement non vérifié avec `InputMediaPaidMedia`. | Non utilisée. |
| Fanvue | `publishAt` sur `POST /v1/posts`, `scheduledAt` sur les envois de masse. | Non utilisée. |

Ce que la règle achète: un seul calendrier, un seul cycle de vie, une seule sémantique d'échec. Éditer ou annuler une publication programmée reste une écriture en base protégée par le verrou optimiste de 7.4, jamais un aller-retour avec la plateforme pour rattraper un objet déjà déposé chez elle. Ce que la règle coûte, et qui est assumé: rien ne part si la stack est éteinte à l'heure dite.

**Forme.** Le workflow démarre **à la programmation**, pas à l'échéance: `workflowId = publication.id` et un timer durable jusqu'à `scheduledAt`. Une reprogrammation arrive par **signal** sur le workflow en cours, pas par annulation puis redémarrage. Pas de balayeur périodique, donc pas de fenêtre de course entre la base et le scheduler.

**Tolérance de retard.** Les timers Temporal sont durables: une stack éteinte à l'heure dite produit une publication **en retard**, pas une publication perdue. Publier en aveugle au réveil est le mauvais comportement: un post prévu à 19 h qui part à 4 h rate son créneau d'audience et pollue les métriques du compte.

Au réveil du timer, le workflow compare l'heure courante et `scheduledAt`:
- écart inférieur à la tolérance: publication normale;
- écart supérieur: la Publication passe en `MISSED`, **aucune écriture externe n'est tentée**, et l'opérateur tranche depuis l'UI (publier maintenant, reprogrammer, abandonner).

Tolérance par défaut: **45 minutes**, surchargeable par ChannelAccount. `MISSED` n'est pas un échec: il ne déclenche pas l'alerting de la section 9, et il apparaît sur le dashboard global à côté des échecs à traiter.

---

## 8. Modèle de données

Les modèles `User`, `Session`, `Account`, `Verification`, `Organization`, `Member` et `Invitation` sont générés par Better Auth et son plugin organization. Ils ne figurent pas ci-dessous et ne doivent pas être écrits à la main.

**Une exception, assumée.** Prisma exige les deux côtés d'une relation. Pour que la base pose réellement les clés étrangères de `Persona.organizationId` et des trois `createdByUserId`, les modèles `User` et `Organization` générés portent des champs de relation inverse ajoutés à la main, balisés en commentaire dans le schéma. Après un `better-auth generate`, il faut les remettre. L'alternative, des clés étrangères posées en SQL brut hors du schéma, ferait diverger la base et le schéma à chaque `migrate dev`: Prisma diffe les clés étrangères, contrairement aux triggers.

```prisma
enum Platform { INSTAGRAM TELEGRAM FANVUE }
enum Rating   { SFW SUGGESTIVE NSFW }
enum PubStatus { DRAFT SCHEDULED PUBLISHING PUBLISHED FAILED MISSED }
enum PubKind   { SINGLE CAROUSEL REEL TG_PAID FV_POST FV_MASS_DM }
enum SubStatus { ACTIVE BLOCKED DEACTIVATED }
enum DeliveryStatus { PENDING SENT FAILED }

model Persona {
  id             String @id @default(cuid())
  organizationId String
  name           String
  handle         String
  timezone       String            // fuseau de la persona
  audienceTimezone String?         // fuseau de l'audience, souvent différent
  bible          Json              // ton de voix, niches, vocabulaire interdit
  channels       ChannelAccount[]
  assets         Asset[]
}

model ChannelAccount {
  id          String   @id @default(cuid())
  personaId   String
  platform    Platform
  externalId  String                  // ig_user_id | chat_id | fanvue account
  credentials Bytes                   // chiffré au repos
  maxRating   Rating                  // INSTAGRAM => SFW, non modifiable via l'UI
  scheduleToleranceMinutes Int?         // surcharge de la tolérance de retard (7.6), défaut applicatif 45
  tokenExpiresAt DateTime?
  @@unique([personaId, platform, externalId])
}

model Asset {
  id              String  @id @default(cuid())
  personaId       String
  createdByUserId String
  rating          Rating                    // immuable après création
  localPath       String
  sha256          String
  variants        Variant[]
  @@unique([personaId, sha256])
}

model Variant {
  id        String  @id @default(cuid())
  assetId   String
  ratio     String                    // "4:5" | "9:16" | "1:1"
  localPath String
  r2Key     String?                   // seulement si SFW et destiné à Instagram
  tgSourceMessageId BigInt?           // pointeur Saved Messages, pas le file_reference
  fvMediaUuid       String?           // media Fanvue après upload multipart, statut ready
}

model Publication {
  id               String @id @default(cuid())
  channelAccountId String
  createdByUserId  String
  version          Int @default(0)     // verrou optimiste, édition concurrente
  kind             PubKind             // SINGLE | CAROUSEL | REEL | TG_PAID | FV_POST | FV_MASS_DM
  copy             String
  scheduledAt      DateTime
  status           PubStatus
  items            PublicationItem[]   // 1 à 10, ordonnés
  starPrice        Int?               // Telegram paid media, en Stars
  priceCents       Int?               // Fanvue, cents USD, minimum 300. Jamais additionné avec starPrice.
  audience         String?            // Fanvue: subscribers | followers-and-subscribers
  previewVariantId String?            // Fanvue: mediaPreviewUuid, teaser gratuit d'un post payant
  expiresAt        DateTime?          // Fanvue: expiration du post
  audioId          String?            // Instagram Audio API, Reels uniquement
  remoteId         String?
  failureReason    String?
  @@unique([channelAccountId, remoteId])
}

model PublicationItem {
  id            String @id @default(cuid())
  publicationId String
  variantId     String
  position      Int
  childContainerId String?            // container enfant Instagram, transitoire
  @@unique([publicationId, position])
}

model TelegramSubscriber {
  id         String @id @default(cuid())
  personaId  String
  tgUserId   BigInt
  source     String?                  // origine de l'acquisition
  status     SubStatus
  @@unique([personaId, tgUserId])
}

model DmCampaign {
  id              String @id @default(cuid())
  personaId       String
  createdByUserId String
  version         Int @default(0)
  caption     String
  starPrice   Int?
  scheduledAt DateTime
  status      PubStatus
  items       DmCampaignItem[]         // 1 à 10, ordonnés
  deliveries  DmDelivery[]
}

model DmCampaignItem {
  id         String @id @default(cuid())
  campaignId String
  variantId  String
  position   Int
  @@unique([campaignId, position])
}

model DmDelivery {
  id           String @id @default(cuid())
  campaignId   String
  subscriberId String
  status       DeliveryStatus
  messageId    BigInt?
  failReason   String?
  @@unique([campaignId, subscriberId])
}

model MetricSnapshot {
  id            String @id @default(cuid())
  personaId     String
  publicationId String?
  capturedAt    DateTime
  payload       Json                  // métriques brutes par plateforme
}

model FanvueEarning {
  id                 String @id @default(cuid())
  personaId          String
  transactionOrderId String
  status             String            // pendingBalance | availableForPayout
  date               DateTime
  grossCents         Int               // cents USD, négatif sur refund et chargeback
  netCents           Int
  source             String            // post | message | tip | subscription | renewal | refund | chargeback | ...
  postUuid           String?           // attribution au média, absente sur Telegram (4.2.5)
  messageUuid        String?
  publicationId      String?           // rapproché via Publication.remoteId
  reversedTransactionOrderId String?
  @@unique([personaId, transactionOrderId])
}
```

**Contrainte à écrire en SQL brut** (Prisma ne l'exprime pas): rejeter toute `Publication` dont **au moins un** `PublicationItem` référence un Variant dont l'Asset a un `rating` supérieur au `maxRating` du `ChannelAccount` cible. Trigger sur `PublicationItem` à l'insertion et à la mise à jour. Le passage au modèle multi-items rend cette contrainte plus facile à contourner par erreur qu'avec un variant unique: elle est non négociable et doit avoir un test dédié couvrant le cas d'un carrousel dont un seul élément sur dix est NSFW.

---

## 9. Sécurité et garde-fous

1. **Anti-NSFW sur Instagram, trois couches:** contrainte en base (8), séparation physique des buckets (5), désactivation explicite du canal dans le Composer (6.1). La couche UI n'est pas un garde-fou en soi, mais elle évite que l'opérateur découvre le blocage au moment de la publication.
2. **Credentials chiffrés au repos.** Clé maître en variable d'environnement, jamais en base, jamais dans le repo.
3. **`.env` hors versionnement.** Un `.env.example` complet et à jour est livré à la place.
4. **Le rating d'un Asset est immuable.** Pas d'édition après création. Pour changer, on crée un nouvel Asset.
5. **Alerting sur trois événements:** échec de refresh de token Meta, `PEER_FLOOD` sur une persona, échec de publication après épuisement des retries.
6. **Scope serveur uniquement.** L'`organizationId` provient toujours de la session, jamais du corps de requête ni de l'URL. Un test doit prouver qu'une requête forgeant un `organizationId` étranger est rejetée.
7. **Credentials plateforme opaques côté client.** Aucune route ne les renvoie, ni en clair ni tronqués. Le rôle `owner` ne change rien à cette règle.
8. **Pas d'inscription ouverte.** L'accès se fait uniquement par invitation d'un `owner`. Aucune route publique de création de compte: `emailAndPassword.disableSignUp` ferme la route de Better Auth, et le seul chemin de création passe par `acceptInvitation`, qui valide l'invitation puis crée le compte via l'adaptateur interne. L'email vient de l'invitation, jamais du formulaire. Faute de fournisseur d'email à ce stade, l'owner récupère un lien et le transmet lui-même.
9. **Mots de passe:** politique par défaut de Better Auth au minimum, sessions expirantes, déconnexion de toutes les sessions au changement de mot de passe.

---

## 10. Points non tranchés

| Sujet | À décider |
|---|---|
| Paid media Telegram en DM | Test bloquant, phase 0 (4.2.6) |
| CGU du fournisseur de stockage sur le contenu adulte | Vérification, phase 0 |
| Réconciliation des revenus Stars sans `payload` | Dépend de la cadence éditoriale retenue |
| Autorisation Fanvue: par persona ou par agence | Si les personas sont regroupées sous une agence Fanvue, une seule autorisation OAuth couvre le portefeuille via les endpoints `/v1/creators/{uuid}/*`, avec un bucket de quota par créatrice (4.3.13). Sinon, une connexion par persona. À vérifier sur les comptes réels avant d'écrire l'adapter, en phase 4. |
| Webhooks Fanvue | Rester en polling quotidien tant qu'il n'y a pas d'ingress HTTPS public (4.3.12). Rouvrir si la latence des revenus devient gênante ou si l'inbox unifiée revient au périmètre. |
| Permissions par persona | Faut-il qu'un `member` soit restreint à un sous-ensemble de personas, plutôt que de voir tout le portefeuille ? Le plugin organization de Better Auth propose des *teams* qui pourraient s'y mapper. À trancher quand une raison concrète apparaît (opérateur externalisé, cloisonnement contractuel), pas avant. |

---

## 11. Bootstrap

À exécuter avant toute autre tâche.

1. Initialiser le dépôt local dans le dossier courant.
2. **Créer le dépôt GitHub distant avec le compte actuellement authentifié**, en le rattachant à ce dossier:
   ```bash
   gh auth status              # vérifier le compte utilisé, ne pas en changer
   gh repo create backdrop --private --source=. --remote=origin --push
   ```
   Le dépôt est **privé**. Ne jamais le passer en public.
3. `.gitignore` couvrant au minimum: `.env*` (sauf `.env.example`), `node_modules`, `.next`, `media/`, `*.session`, `__pycache__`.
4. Premier commit avec ce `spec.md` à la racine.

---

## 12. Plan

Chaque phase se termine par un `docker compose up` fonctionnel et un commit. Ne pas démarrer une phase tant que la Definition of Done de la précédente n'est pas atteinte.

### Phase 0 — Validation et fondations

**À faire**
- Bootstrap du dépôt (section 11).
- Compose avec `postgres`, `postgres-temporal`, `temporal`, `temporal-ui`. Aucun worker encore.
- Schéma Prisma complet de la section 8, migration appliquée, y compris la contrainte SQL de rating.
- Better Auth avec le plugin organization: authentification email et mot de passe, invitation de membres, rôles `owner` et `member`. Pas de route d'inscription publique.
- Tailwind et shadcn/ui initialisés, dark mode appliqué par défaut sur `<html>`, layout applicatif avec le sélecteur de persona dans le header.
- **Test bloquant 4.2.6:** script Python isolé, `SendMedia` + `InputMediaPaidMedia` vers un channel puis vers un `InputPeerUser`. Consigner les deux résultats et l'erreur exacte dans `docs/findings/telegram-paid-media-dm.md`.
- Vérification des CGU du fournisseur de stockage objet sur le contenu adulte, consignée dans `docs/findings/storage-tos.md`.

**Definition of Done**
- `docker compose up` démarre sans erreur, Temporal UI accessible.
- `prisma migrate` passe sur base vierge.
- Un test automatisé prouve qu'insérer une Publication d'un Asset NSFW vers un ChannelAccount Instagram est **rejeté par la base**.
- Un `owner` peut inviter un second compte, celui-ci se connecte et voit les mêmes personas.
- Un test prouve qu'une requête portant un `organizationId` qui n'est pas celui de la session est rejetée.
- Aucune route ne renvoie de credential plateforme, vérifié sur l'ensemble des endpoints exposant un ChannelAccount.
- Les deux fichiers de `docs/findings/` sont écrits et la décision sur le DM payant est tranchée dans ce spec.

### Phase 1 — Instagram, une persona

**À faire**
- `worker-node` avec le SDK Temporal.
- Adapter Instagram: post simple, carrousel (containers enfants puis parent), Reel. Polling `status_code` sur chaque container, publish, persistance du `remote_id`, contrôle de `content_publishing_limit` avant envoi.
- Workflow `ingestVariant`: upload, ffmpeg (`+faststart`, ratios 4:5 et 9:16), écriture locale, push R2 si SFW.
- Workflow `publishInstagram` avec `workflowId = publication.id`.
- Workflow `refreshMetaTokens` en Temporal Schedule.
- UI minimale: upload, choix du ratio, saisie de la légende, date de programmation, liste des publications avec leur état.

**Definition of Done**
- Une image programmée est publiée sur le compte Instagram réel de Carolina Violet à l'heure prévue, sans intervention.
- Un carrousel de cinq images se publie avec la bonne légende et le bon ordre.
- Une vidéo passe le container et se publie en Reel.
- L'échec d'un seul container enfant fait échouer le carrousel proprement, sans publier un post partiel.
- Relancer le même workflow ne produit pas de doublon (vérifié).
- Un token expiré est rafraîchi automatiquement, vérifié en forçant l'expiration.
- Un échec de publication laisse la Publication en `FAILED` avec une `failureReason` lisible dans l'UI, sans faire tomber le worker.
- Une publication dont l'échéance est dépassée au-delà de la tolérance passe en `MISSED` sans rien publier, et l'opérateur peut la relancer ou l'abandonner depuis l'UI (vérifié en décalant l'horloge).
- Chaque publication affiche son auteur dans l'UI, et deux utilisateurs éditant la même Publication déclenchent un rejet explicite sur le second enregistrement, sans perte de données.

### Phase 2 — Telegram channel

**À faire**
- `worker-telegram` en Python, `replicas: 1`, task queue dédiée, dictionnaire `persona_id → Client`.
- Stockage chiffré des string sessions, `device_model` / `system_version` / `app_version` fixés et persistés.
- Extension d'`ingestVariant`: upload vers Saved Messages, persistance du `tgSourceMessageId`.
- Activité `resolveTelegramMedia` régénérant un `file_reference` frais via `messages.GetMessages`.
- Workflow `publishTelegramChannel` avec `InputMediaPaidMedia`.
- Gestion `FLOOD_WAIT` (backoff dicté par le serveur) et `PEER_FLOOD` (arrêt et alerte).

**Definition of Done**
- Un média payant programmé apparaît sur le channel réel, floué, au prix en Stars configuré, et se déverrouille après achat depuis un compte de test.
- Un Variant uploadé il y a plus de 24 h se publie sans `FILE_REFERENCE_EXPIRED`.
- Le second démarrage du worker ne provoque pas d'`AUTH_KEY_DUPLICATED` (test de redémarrage).
- Un `FLOOD_WAIT` est absorbé et le workflow reprend, visible dans Temporal UI.

### Phase 3 — Composer multi-canal et DM

**À faire**
- Écran Composer: un Asset, cases à cocher par canal, dérivation automatique des Variants, texte et prix éditables par canal.
- Dérivations: recadrage assisté, watermark conditionnel, flou pour dériver un teaser SFW depuis un master NSFW.
- Modèle `TelegramSubscriber` alimenté, avec source d'acquisition.
- Workflow `runDmCampaign`: snapshot matérialisé en base, boucle throttlée à 20-25 envois par seconde, une activité idempotente par `DmDelivery`.
- Gestion d'états sur erreur: compte bloqué ou désactivé bascule le subscriber en `BLOCKED` / `DEACTIVATED`, exclu des campagnes suivantes.

**Definition of Done**
- Un seul upload produit une publication Instagram et une publication Telegram, avec des textes et des formats distincts, en une action.
- Les Assets NSFW et SUGGESTIVE apparaissent floutés par défaut dans la Library et le Composer, et le canal Instagram est grisé avec explication quand le rating l'interdit.
- Une campagne DM de 50 destinataires s'exécute intégralement, les échecs sont classés par cause, et les subscribers concernés sont marqués.
- Interrompre le worker en plein blast puis le redémarrer ne réenvoie aucun message déjà délivré.
- Le média est uploadé **une seule fois** pour toute la campagne (vérifié dans les logs).

### Phase 4 — Fanvue et insights

**À faire**
- App Fanvue créée dans le Builder (type off-platform), `client_id` / `client_secret` en variables d'environnement. Trancher au passage compte simple ou agence (section 10).
- Flux OAuth PKCE dans le web, réservé au rôle `owner`: autorisation, échange du code côté serveur, stockage chiffré du refresh token.
- Activité `refreshFanvueToken` **sérialisée par ChannelAccount** (advisory lock), écriture du nouveau refresh token avant tout autre appel (4.3.3).
- Adapter Fanvue respectant le contrat de la section 7.4, en-tête de version épinglé.
- Extension d'`ingestVariant`: upload multipart vers le vault Fanvue, attente du statut `ready`, persistance du `fvMediaUuid`.
- Workflow `publishFanvue`: post payant avec `mediaPreviewUuid` et `price`, ou envoi de masse par listes. Relecture anti-doublon avant tout retry de POST (4.3.9).
- Workflow `collectInsights` quotidien: insights Instagram et compteurs Telegram vers `MetricSnapshot`, revenus Fanvue paginés par curseur et upsertés dans `FanvueEarning`.
- Dashboard par persona: publications, croissance, revenus.
- Dashboard global: comparaison entre personas, calendrier de scheduling tous canaux confondus.

**Definition of Done**
- Un média part sur les trois canaux depuis le Composer.
- Un post payant Fanvue apparaît à l'heure prévue, avec son teaser gratuit visible et son prix, et se déverrouille après achat depuis un compte de test.
- Un access token expiré est rafraîchi sans intervention, et deux rafraîchissements concurrents sur le même compte sont sérialisés: un test le prouve, la chaîne de refresh survit.
- Rejouer `publishFanvue` après un timeout simulé ne crée pas de second post (vérifié).
- Un média non `ready` n'est jamais attaché à un post: le workflow attend, il n'échoue pas.
- Les revenus Fanvue sont rattachés au bon média via `postUuid`, et un remboursement apparaît en ligne négative rapprochée de la transaction d'origine.
- Le dashboard global affiche les trois personas côte à côte, sans requête cross-tenant.
- Les revenus Stars et les revenus Fanvue apparaissent en lignes distinctes, jamais additionnés sans conversion explicite.
- Je peux répondre à "quel média a le mieux converti ce mois-ci" en moins de trente secondes dans l'outil.
