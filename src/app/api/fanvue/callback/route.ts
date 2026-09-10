import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/public-url";
import { Platform, Rating } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptCredentials, safeEqual } from "@/lib/crypto";
import { requireOwner, resolvePersona } from "@/lib/session";
import { readFanvueApp } from "@/lib/channels/fanvue-app";
import {
  exchangeCode,
  FanvueAdapter,
  type FanvueCredentials,
} from "@/lib/channels/fanvue";
import { FANVUE_OAUTH_COOKIE } from "../authorize/route";

/**
 * Retour d'autorisation Fanvue.
 *
 * Le compte n'est créé qu'ici, une fois les jetons obtenus et l'identité de la
 * créatrice lue: un ChannelAccount sans jetons afficherait « connecté » et
 * échouerait au premier envoi.
 */
export async function GET(request: Request) {
  const ctx = await requireOwner();
  const url = new URL(request.url);
  // L'origine vue du navigateur, pas celle du conteneur.
  const origin = publicOrigin(request);
  const back = (reason: string) =>
    NextResponse.redirect(new URL(`/settings?fanvue=${reason}`, origin));

  const jar = await cookies();
  const raw = jar.get(FANVUE_OAUTH_COOKIE)?.value;
  jar.delete(FANVUE_OAUTH_COOKIE);
  if (!raw) return back("expired");

  const session = JSON.parse(raw) as {
    state: string;
    verifier: string;
    personaId: string;
  };

  const error = url.searchParams.get("error");
  if (error) return back("refused");

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  // Comparaison à temps constant: l'état est le garde-fou anti-CSRF du flux.
  if (!state || !safeEqual(state, session.state)) return back("state");
  if (!code) return back("code");

  const persona = await resolvePersona(session.personaId, ctx);
  if (!persona) return back("persona");

  const app = await readFanvueApp(ctx.organizationId);
  if (!app) return back("app");

  try {
    const tokens = await exchangeCode({
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      code,
      redirectUri: app.redirectUri,
      codeVerifier: session.verifier,
    });

    const credentials: FanvueCredentials = {
      userUuid: "",
      handle: "",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
      expiresAt: Date.now() + tokens.expires_in * 1000,
      clientId: app.clientId,
      clientSecret: app.clientSecret,
    };

    // L'identité vient de l'API, pas d'une saisie: c'est elle qui donne
    // l'`externalId` du compte, et elle confirme au passage que le jeton
    // fonctionne avant qu'on n'enregistre quoi que ce soit.
    const me = await new FanvueAdapter(credentials).me();
    credentials.userUuid = me.uuid;
    credentials.handle = me.handle;

    await prisma.channelAccount.upsert({
      where: {
        personaId_platform_externalId: {
          personaId: persona.id,
          platform: Platform.FANVUE,
          externalId: me.uuid,
        },
      },
      create: {
        personaId: persona.id,
        platform: Platform.FANVUE,
        externalId: me.uuid,
        credentials: encryptCredentials(credentials),
        // Fanvue est le seul canal sans plafond de rating: c'est sa raison
        // d'être dans l'outil (section 8).
        maxRating: Rating.NSFW,
        tokenExpiresAt: new Date(credentials.expiresAt),
      },
      update: {
        credentials: encryptCredentials(credentials),
        tokenExpiresAt: new Date(credentials.expiresAt),
      },
    });

    return NextResponse.redirect(new URL("/settings?fanvue=connected", origin));
  } catch {
    // Rien du détail ne remonte à l'URL: un message d'erreur d'OAuth peut
    // porter des fragments de jeton (9.7).
    return back("failed");
  }
}
