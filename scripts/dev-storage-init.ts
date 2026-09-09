/**
 * Prépare le stockage objet local: crée le bucket et le rend lisible
 * publiquement, puisque Meta doit pouvoir y faire un cURL anonyme (4.1.6).
 *
 * Ne fait rien si R2_ENDPOINT est vide, c'est-à-dire en production.
 *
 *   pnpm tsx scripts/dev-storage-init.ts
 */
import "dotenv/config";
import {
  S3Client,
  CreateBucketCommand,
  PutBucketPolicyCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";

async function main() {
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET;
  if (!endpoint) {
    console.log("R2_ENDPOINT vide: rien à faire (configuration de production).");
    return;
  }
  if (!bucket) throw new Error("R2_BUCKET manquant.");

  const client = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`bucket ${bucket} déjà présent`);
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`bucket ${bucket} créé`);
  }

  await client.send(
    new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { AWS: ["*"] },
            Action: ["s3:GetObject"],
            Resource: [`arn:aws:s3:::${bucket}/*`],
          },
        ],
      }),
    }),
  );
  console.log("lecture anonyme autorisée sur les objets");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
