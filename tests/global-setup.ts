import { config } from "dotenv";
import { execSync } from "node:child_process";

/** Applique les migrations sur la base de test avant toute la suite. */
export default function setup() {
  config({ path: ".env.test", override: true });
  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
}
