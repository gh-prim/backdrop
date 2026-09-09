# Paid media Telegram en conversation privée

> Tâche bloquante 4.2.6 du spec. Statut: **non tranché — en attente d'exécution**.
> Le script est écrit et prêt; il lui manque des credentials que seul
> l'opérateur possède.

## Question

`messages.SendMedia` avec `InputMediaPaidMedia` fonctionne-t-il vers un
`InputPeerUser`, en session utilisateur (pas bot) ?

L'enjeu n'est pas cosmétique. Il décide si le DM Telegram est un rail de
paiement ou un canal purement relationnel, donc si `DmCampaign` porte un
`starPrice` utile ou si l'upsell passe par un lien Fanvue.

## État de la connaissance avant test

- Toute la documentation MTProto décrit `inputMediaPaidMedia` comme une
  fonctionnalité de **channel**.
- L'ouverture « to any chat » est documentée côté **Bot API** et suppose un
  solde de bot, qui n'a pas d'équivalent pour un compte utilisateur.
- L'application officielle ne propose pas de média payant en conversation
  privée.
- Le champ `payload` et l'update `updateBotPurchasedPaidMedia` sont marqués
  **bots only** (4.2.5), ce qui va dans le même sens.

**Hypothèse de travail: l'envoi en DM échoue.** Le repli est déjà décidé et
acceptable (voir plus bas). Le test sert à le confirmer et à consigner l'erreur
exacte, pas à espérer.

## Comment exécuter le test

Le script est à [`scripts/telegram_paid_media_probe.py`](../../scripts/telegram_paid_media_probe.py).
Il est isolé: pas de Prisma, pas de Temporal, aucun import applicatif.

```bash
pip install hydrogram tgcrypto

export TELEGRAM_API_ID=...          # couple unique de l'application (4.2.1)
export TELEGRAM_API_HASH=...
export TELEGRAM_SESSION=...         # string session d'une persona de test
export TG_TEST_CHANNEL=@channel_de_test
export TG_TEST_USER=@compte_de_test
export TG_TEST_FILE=./chemin/vers/une/image.jpg

python scripts/telegram_paid_media_probe.py
```

Le script fait trois choses:

1. Se connecte avec un fingerprint figé (`device_model`, `system_version`,
   `app_version`), conformément à 4.2.3.
2. Uploade une image une seule fois et en dérive un média réutilisable (4.2.7).
3. Envoie le même média payant **vers un channel** puis **vers un utilisateur**,
   et imprime le résultat exact de chacun.

## Ce qui reste à faire

- [ ] Obtenir `api_id` / `api_hash` sur my.telegram.org.
- [ ] Générer une string session pour une persona de test.
- [ ] Créer un channel de test et un second compte Telegram de test.
- [ ] Exécuter le script, **coller la sortie intégrale ci-dessous**.
- [ ] Trancher dans le spec (4.2.6) et ajuster le modèle `DmCampaign` si besoin.

## Résultats

### A. Vers un channel

```
non exécuté
```

### B. Vers une conversation privée

```
non exécuté
```

## Décision

**En attente.** Tant que le test n'a pas tourné, la phase 3 est construite sur
l'hypothèse de repli:

> Le DM Telegram est relationnel. L'upsell passe par un lien Fanvue. Un seul
> rail de paiement Telegram: le channel.

Si le test réussit contre toute attente, `DmCampaign.starPrice` devient
opérationnel et la contrainte éditoriale de 4.2.5 (un seul média payant par
jour et par destinataire, faute d'attribution par achat) s'applique aussi aux
campagnes DM.

## Pourquoi ce n'est pas bloquant pour la phase 0

La phase 0 ne touche pas Telegram: pas de worker, pas de session, pas d'envoi.
Le test devient bloquant à l'entrée de la **phase 3**, quand `runDmCampaign`
est construit. Il doit être fait avant, pas pendant.
