import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins/organization";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "./db";
import { envOr } from "./env";

/**
 * Authentification locale, email et mot de passe (spec 1 et 7.4).
 *
 * Deux règles non négociables:
 *  - `disableSignUp`: aucune route publique de création de compte (9.8).
 *    Un compte ne naît que d'une invitation acceptée, via `acceptInvitation`
 *    dans src/lib/invitations.ts.
 *  - `allowUserToCreateOrganization`: false. L'Organization est le tenant,
 *    elle est créée par le script de seed, pas par un utilisateur.
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: envOr("BETTER_AUTH_URL", "http://localhost:3000"),

  /**
   * L'instance est joignable par deux portes: la façade HTTPS, exigée par le
   * retour d'autorisation Fanvue (4.3.2), et le port en clair du service web.
   *
   * Sans cette liste, une session ouverte sur l'une est refusée sur l'autre,
   * et le retour d'OAuth atterrit sur l'écran de connexion — au moment
   * précis où le code d'autorisation, à usage unique, est déjà consommé.
   */
  trustedOrigins: envOr(
    "AUTH_TRUSTED_ORIGINS",
    "http://localhost:3100,https://localhost:3443",
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),

  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 jours
    updateAge: 60 * 60 * 24, // prolongation quotidienne
  },

  plugins: [
    organization({
      allowUserToCreateOrganization: false,
      // Deux rôles seulement (7.4). Le plugin en connaît un troisième (`admin`)
      // que l'application n'attribue jamais: voir ORG_ROLES et assertRole.
      invitationExpiresIn: 60 * 60 * 24 * 7,
    }),
    nextCookies(),
  ],
});

/** Les seuls rôles que l'application attribue (7.4). */
export const ORG_ROLES = ["owner", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}
