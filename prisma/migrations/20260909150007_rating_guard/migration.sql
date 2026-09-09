-- Garde-fou anti-NSFW, couche base de données (spec 8 et 9.1).
--
-- Rejette toute Publication dont AU MOINS UN PublicationItem référence un
-- Variant dont l'Asset porte un rating supérieur au maxRating du
-- ChannelAccount cible. Prisma ne sait pas exprimer cette contrainte:
-- elle traverse quatre tables.
--
-- Le cas qui compte: un carrousel de dix éléments dont un seul est NSFW,
-- programmé vers Instagram. Il doit être rejeté par la base, quoi que fasse
-- le code applicatif.

CREATE OR REPLACE FUNCTION backdrop_rating_rank(r "Rating")
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE r
    WHEN 'SFW'        THEN 0
    WHEN 'SUGGESTIVE' THEN 1
    WHEN 'NSFW'       THEN 2
  END;
$$;

-- Vérifie un couple (publication, variant).
CREATE OR REPLACE FUNCTION backdrop_assert_rating(p_publication_id text, p_variant_id text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_asset_rating "Rating";
  v_max_rating   "Rating";
  v_platform     "Platform";
BEGIN
  SELECT a."rating" INTO v_asset_rating
  FROM "Variant" v
  JOIN "Asset" a ON a."id" = v."assetId"
  WHERE v."id" = p_variant_id;

  SELECT ca."maxRating", ca."platform" INTO v_max_rating, v_platform
  FROM "Publication" p
  JOIN "ChannelAccount" ca ON ca."id" = p."channelAccountId"
  WHERE p."id" = p_publication_id;

  IF v_asset_rating IS NULL OR v_max_rating IS NULL THEN
    RETURN; -- les clés étrangères traitent déjà le cas des références absentes
  END IF;

  IF backdrop_rating_rank(v_asset_rating) > backdrop_rating_rank(v_max_rating) THEN
    RAISE EXCEPTION
      'rating_violation: asset % interdit sur un canal % limité à %',
      v_asset_rating, v_platform, v_max_rating
      USING ERRCODE = '23514';
  END IF;
END;
$$;

-- 1. À l'insertion et à la mise à jour d'un item.
CREATE OR REPLACE FUNCTION backdrop_publication_item_rating_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM backdrop_assert_rating(NEW."publicationId", NEW."variantId");
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publication_item_rating_guard ON "PublicationItem";
CREATE TRIGGER publication_item_rating_guard
  AFTER INSERT OR UPDATE OF "variantId", "publicationId" ON "PublicationItem"
  FOR EACH ROW
  EXECUTE FUNCTION backdrop_publication_item_rating_guard();

-- 2. Au déplacement d'une Publication vers un autre canal.
--    Sans ceci, il suffirait de créer la publication sur Telegram puis de la
--    basculer sur Instagram pour contourner le trigger ci-dessus.
CREATE OR REPLACE FUNCTION backdrop_publication_channel_rating_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item record;
BEGIN
  FOR item IN SELECT "variantId" FROM "PublicationItem" WHERE "publicationId" = NEW."id" LOOP
    PERFORM backdrop_assert_rating(NEW."id", item."variantId");
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS publication_channel_rating_guard ON "Publication";
CREATE TRIGGER publication_channel_rating_guard
  AFTER UPDATE OF "channelAccountId" ON "Publication"
  FOR EACH ROW
  EXECUTE FUNCTION backdrop_publication_channel_rating_guard();
