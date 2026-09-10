import { describe, it, expect, beforeEach } from "vitest";
import { Platform, Rating } from "@prisma/client";
import {
  prisma,
  resetDatabase,
  createOrganization,
  createUser,
  createPersona,
  createChannel,
  createVariant,
} from "./helpers";
import { exportConfig, importConfig, OperatorError } from "@/lib/config-backup";
import { decryptCredentials, encryptCredentials } from "@/lib/crypto";

/**
 * La sauvegarde de configuration doit remonter une instance ailleurs — sans
 * jamais faire voyager un identifiant en clair, et sans rien détruire au
 * passage. Ces trois propriétés sont ce que les tests tiennent.
 */
describe("sauvegarde de configuration", () => {
  const PASSPHRASE = "correct horse battery staple";
  let source: { organizationId: string };
  let userId: string;
  let personaId: string;
  let handle: string;

  beforeEach(async () => {
    await resetDatabase();
    const org = await createOrganization("Source");
    const user = await createUser();
    const persona = await createPersona(org.id, "Carolina");
    userId = user.id;
    personaId = persona.id;
    handle = persona.handle;
    source = { organizationId: org.id };

    const channel = await createChannel(personaId, Platform.INSTAGRAM, Rating.SFW);
    await prisma.instagramHashtag.create({
      data: { channelAccountId: channel.id, name: "gym", hashtagId: "17843" },
    });
  });

  async function targetOrg() {
    const org = await createOrganization("Cible");
    return { organizationId: org.id };
  }

  it("n'emporte aucun identifiant sans phrase de passe", async () => {
    const backup = await exportConfig(source as never);

    expect(backup.secrets).toBeNull();
    // La preuve par le texte: rien du contenu chiffré ne doit se retrouver
    // dans le fichier, sous quelque forme que ce soit.
    expect(JSON.stringify(backup)).not.toContain("chiffré-au-repos");
  });

  it("scelle les identifiants et les rouvre à l'identique", async () => {
    const backup = await exportConfig(source as never, { passphrase: PASSPHRASE });
    expect(backup.secrets).not.toBeNull();
    expect(JSON.stringify(backup)).not.toContain("chiffré-au-repos");

    const target = await targetOrg();
    await importConfig(target as never, backup, { passphrase: PASSPHRASE });

    const restored = await prisma.channelAccount.findFirstOrThrow({
      where: { persona: { organizationId: target.organizationId } },
    });
    expect(decryptCredentials(restored.credentials)).toEqual({
      secret: "chiffré-au-repos",
    });
  });

  it("refuse une phrase de passe fausse sans en dire plus", async () => {
    const backup = await exportConfig(source as never, { passphrase: PASSPHRASE });
    const target = await targetOrg();

    await expect(
      importConfig(target as never, backup, { passphrase: "pas la bonne" }),
    ).rejects.toBeInstanceOf(OperatorError);
  });

  it("recrée personas et hashtags dans une organisation vierge", async () => {
    const backup = await exportConfig(source as never, { passphrase: PASSPHRASE });
    const target = await targetOrg();

    const plan = await importConfig(target as never, backup, { passphrase: PASSPHRASE });
    expect(plan.personasCreated).toEqual([handle]);
    expect(plan.channelsCreated).toHaveLength(1);

    const hashtags = await prisma.instagramHashtag.findMany({
      where: { channelAccount: { persona: { organizationId: target.organizationId } } },
    });
    // Un identifiant Meta coûte une recherche sur les 30 hebdomadaires: le
    // réimporter, c'est ce qui évite de rebrûler le quota.
    expect(hashtags.map((h) => h.hashtagId)).toEqual(["17843"]);
  });

  it("laisse le canal de côté quand le fichier n'a pas les identifiants", async () => {
    const backup = await exportConfig(source as never);
    const target = await targetOrg();

    const plan = await importConfig(target as never, backup);
    expect(plan.channelsCreated).toEqual([]);
    // Un canal sans identifiants afficherait « connecté » et échouerait au
    // premier envoi: on le dit plutôt que de le créer.
    expect(plan.channelsSkipped).toHaveLength(1);
  });

  it("emporte l'application OAuth Fanvue, sans laquelle rien ne se réautorise", async () => {
    await prisma.fanvueApp.create({
      data: {
        organizationId: source.organizationId,
        credentials: encryptCredentials({
          clientId: "client",
          clientSecret: "secret",
          redirectUri: "https://localhost:3443/api/fanvue/callback",
        }),
      },
    });

    const backup = await exportConfig(source as never, { passphrase: PASSPHRASE });
    const target = await targetOrg();
    const plan = await importConfig(target as never, backup, { passphrase: PASSPHRASE });

    // Sans elle, une instance restaurée a ses canaux Fanvue et aucun moyen de
    // les réautoriser: le parcours n'a plus de client_id à présenter.
    expect(plan.fanvueApp).toBe(true);
    const restored = await prisma.fanvueApp.findUniqueOrThrow({
      where: { organizationId: target.organizationId },
    });
    expect(decryptCredentials(restored.credentials)).toMatchObject({ clientId: "client" });
  });

  it("est idempotent: deux imports laissent le même état", async () => {
    const backup = await exportConfig(source as never, { passphrase: PASSPHRASE });
    const target = await targetOrg();

    await importConfig(target as never, backup, { passphrase: PASSPHRASE });
    const second = await importConfig(target as never, backup, { passphrase: PASSPHRASE });

    expect(second.personasCreated).toEqual([]);
    expect(second.personasUpdated).toEqual([handle]);
    expect(second.channelsCreated).toEqual([]);
    expect(
      await prisma.persona.count({ where: { organizationId: target.organizationId } }),
    ).toBe(1);
  });

  it("n'écrit rien en simulation", async () => {
    const backup = await exportConfig(source as never, { passphrase: PASSPHRASE });
    const target = await targetOrg();

    const plan = await importConfig(target as never, backup, {
      passphrase: PASSPHRASE,
      dryRun: true,
    });
    expect(plan.personasCreated).toEqual([handle]);
    expect(
      await prisma.persona.count({ where: { organizationId: target.organizationId } }),
    ).toBe(0);
  });

  it("recolle un album sur les empreintes présentes, et compte les absentes", async () => {
    const here = await createVariant(personaId, userId, Rating.SFW);
    const gone = await createVariant(personaId, userId, Rating.SFW);
    const assets = await prisma.asset.findMany({
      where: { id: { in: [here.assetId, gone.assetId] } },
      select: { id: true, sha256: true },
    });
    await prisma.album.create({
      data: {
        personaId,
        name: "Vestiaire",
        items: { create: assets.map((asset, position) => ({ assetId: asset.id, position })) },
      },
    });

    const backup = await exportConfig(source as never, { passphrase: PASSPHRASE });

    // Dans l'organisation cible, un seul des deux médias existe: les fichiers
    // ne voyagent pas avec la configuration.
    const target = await targetOrg();
    const twin = await createPersona(target.organizationId, "Carolina");
    // Même handle que la source: c'est la clé naturelle sur laquelle l'import
    // recolle, les cuid n'ayant aucun sens d'une instance à l'autre.
    await prisma.persona.update({ where: { id: twin.id }, data: { handle } });
    await prisma.asset.create({
      data: {
        personaId: twin.id,
        createdByUserId: userId,
        rating: Rating.SFW,
        localPath: "/media/copie.jpg",
        sha256: assets[0].sha256,
      },
    });

    const plan = await importConfig(target as never, backup, { passphrase: PASSPHRASE });
    expect(plan.albumsCreated).toEqual(["Vestiaire"]);
    expect(plan.missingMedia).toBe(1);

    const album = await prisma.album.findFirstOrThrow({
      where: { personaId: twin.id },
      select: { items: true },
    });
    expect(album.items).toHaveLength(1);
  });
});
