import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { publicOrigin } from "@/lib/public-url";
import { requireOwner, resolvePersona } from "@/lib/session";
import { readFanvueApp } from "@/lib/channels/fanvue-app";
import { authorizeUrl } from "@/lib/channels/fanvue";

/**
 * Départ du flux OAuth Fanvue (4.3.2).
 *
 * Connecter un compte Fanvue est un **parcours interactif**, pas un collage de
 * jeton dans un formulaire: l'API n'a pas de clé statique. Le rôle `owner` est
 * exigé, comme pour tout ce qui touche aux ChannelAccount (7.4).
 *
 * PKCE est obligatoire côté Fanvue. Le vérifieur et l'état de session voyagent
 * dans un cookie httpOnly de courte durée: ils ne doivent ni atteindre le
 * navigateur en clair, ni survivre au parcours.
 */

export const FANVUE_OAUTH_COOKIE = "fanvue_oauth";

export async function GET(request: Request) {
  const ctx = await requireOwner();

  const url = new URL(request.url);
  // L'origine vue du navigateur, pas celle du conteneur.
  const origin = publicOrigin(request);
  const personaId = url.searchParams.get("personaId") ?? "";
  const persona = await resolvePersona(personaId, ctx);
  if (!persona) {
    return NextResponse.redirect(new URL("/settings?fanvue=persona", origin));
  }

  const app = await readFanvueApp(ctx.organizationId);
  if (!app) {
    return NextResponse.redirect(new URL("/settings?fanvue=app", origin));
  }

  // `base64url`: le vérifieur PKCE voyage dans une URL, et un `+` ou un `/`
  // encodé de travers casse la vérification côté serveur d'autorisation.
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");

  const jar = await cookies();
  jar.set(FANVUE_OAUTH_COOKIE, JSON.stringify({ state, verifier, personaId }), {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https:"),
    path: "/",
    maxAge: 10 * 60,
  });

  return NextResponse.redirect(
    authorizeUrl({
      clientId: app.clientId,
      redirectUri: app.redirectUri,
      state,
      codeChallenge: challenge,
    }),
  );
}
