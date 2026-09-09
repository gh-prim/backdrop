import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/session";
import { instagramAdapterFor } from "@/lib/channels/instagram-account";

/**
 * Relais d'écoute d'une piste Instagram.
 *
 * Deux raisons d'exister plutôt que de pointer directement le CDN de Meta:
 *
 *  - **Le tracé de forme d'onde a besoin des octets.** Le décodage audio dans
 *    le navigateur exige une origine autorisée, et le CDN de Meta ne l'accorde
 *    pas. En passant par ici, la ressource devient de même origine.
 *  - **L'URL du CDN est signée.** La laisser filer au client la rendrait
 *    partageable hors de l'outil; elle reste côté serveur.
 *
 * Comme la route média locale, elle exige une session valide et le scope
 * d'organisation (9.6).
 */
export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ channelAccountId: string; audioId: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx) return new NextResponse("Non authentifié", { status: 401 });

  const { channelAccountId, audioId } = await params;
  const adapter = await instagramAdapterFor(ctx, channelAccountId);
  if (!adapter) return new NextResponse("Canal introuvable", { status: 404 });

  let downloadUrl: string | null = null;
  try {
    downloadUrl = (await adapter.getAudio(audioId)).downloadUrl;
  } catch {
    return new NextResponse("Piste indisponible", { status: 502 });
  }

  // Musique sous licence: Meta n'en distribue pas le master. Ce n'est pas une
  // erreur, c'est la règle — le client bascule alors sur le lien Instagram.
  if (!downloadUrl) return new NextResponse("Écoute non distribuée", { status: 404 });

  const upstream = await fetch(downloadUrl);
  if (!upstream.ok || !upstream.body) {
    return new NextResponse("Lecture impossible", { status: 502 });
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "audio/mpeg",
      "Cache-Control": "private, max-age=600",
    },
  });
}
