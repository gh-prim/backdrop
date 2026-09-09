import { S3Client, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { envOrNull } from "@/lib/env";

/**
 * Accès au stockage objet (R2, ou tout équivalent S3).
 *
 * Un seul endroit construit le client: la configuration de repli vers
 * Backblaze B2 décrite dans docs/findings/storage-tos.md se réduit alors à
 * changer des variables d'environnement, pas du code.
 */
export function objectStorageClient(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;

  // `||` et non `??`: Docker Compose transmet une variable non définie comme
  // **chaîne vide**, que `??` laisserait passer. La surcharge d'endpoint
  // serait alors une chaîne vide jugée valide, et le client ne serait jamais
  // construit — panne silencieuse qui a coûté trois publications.
  const endpoint =
    envOrNull("R2_ENDPOINT") ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);
  if (!endpoint) return null;

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    // Indispensable hors Cloudflare: MinIO et consorts servent le bucket en
    // préfixe de chemin, pas en sous-domaine.
    forcePathStyle: Boolean(envOrNull("R2_ENDPOINT")),
  });
}

/**
 * Retire des objets du bucket.
 *
 * Utilisé quand un média cesse d'être SFW ou disparaît: laisser un fichier
 * publiquement téléchargeable après un reclassement viderait de son sens la
 * séparation de la section 5.
 */
export async function deleteObjects(keys: string[]): Promise<number> {
  const cleaned = keys.filter(Boolean);
  if (cleaned.length === 0) return 0;

  const client = objectStorageClient();
  const bucket = process.env.R2_BUCKET;
  if (!client || !bucket) return 0;

  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: cleaned.map((Key) => ({ Key })) },
    }),
  );
  return cleaned.length;
}
