import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build autonome pour l'image Docker: Next trace les dépendances réellement
  // atteintes et les copie dans `.next/standalone`. L'image finale n'embarque
  // donc ni pnpm, ni le lockfile, ni les 900 Mo de node_modules de build.
  output: "standalone",

  experimental: {
    // Les Server Actions plafonnent à 1 Mo par défaut, ce qui refuse la
    // moindre photo. On monte à 50 Mo: assez pour une image et pour une vidéo
    // courte de test.
    //
    // Ce n'est pas la solution durable pour la vidéo: une Server Action
    // bufferise le corps en mémoire. Un Reel d'un poids réaliste devra passer
    // par un route handler qui écrit le flux directement sur le volume, sans
    // le charger entièrement. À faire avant que la vidéo devienne un usage
    // quotidien.
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
