-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "name" TEXT;

-- Le rating d'un Asset devient modifiable (9.4). La garantie ne doit pas
-- s'affaiblir pour autant: le trigger de PublicationItem ne se déclenchait
-- qu'à l'insertion d'un item, donc reclasser un Asset après coup passait
-- sous son radar.
--
-- Celui-ci revalide, à chaque changement de rating, **toutes** les
-- publications qui référencent l'un de ses Variants. Reclasser en NSFW un
-- média déjà programmé sur Instagram est donc refusé par la base.
CREATE OR REPLACE FUNCTION backdrop_asset_rating_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT pi."publicationId", pi."variantId"
    FROM "PublicationItem" pi
    JOIN "Variant" v ON v."id" = pi."variantId"
    WHERE v."assetId" = NEW."id"
  LOOP
    PERFORM backdrop_assert_rating(item."publicationId", item."variantId");
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS asset_rating_guard ON "Asset";
CREATE TRIGGER asset_rating_guard
  AFTER UPDATE OF "rating" ON "Asset"
  FOR EACH ROW
  EXECUTE FUNCTION backdrop_asset_rating_guard();
