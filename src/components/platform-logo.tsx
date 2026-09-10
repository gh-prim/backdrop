import { cn } from "cn";

/**
 * Marques des plateformes, en SVG intégrés.
 *
 * Aucune requête réseau: un logo distant échouerait hors ligne et ferait fuiter
 * la navigation de l'opérateur vers un tiers.
 *
 * Le glyphe Fanvue est vectorisé depuis l'icône officielle de la marque: son
 * tracé n'est pas une invention, mais il n'est pas non plus le fichier
 * d'origine — à remplacer si Fanvue publie un SVG.
 */

type Props = { className?: string };

export function InstagramLogo({ className }: Props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-6", className)}>
      <defs>
        <linearGradient id="ig-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#FEDA75" />
          <stop offset="25%" stopColor="#FA7E1E" />
          <stop offset="50%" stopColor="#D62976" />
          <stop offset="75%" stopColor="#962FBF" />
          <stop offset="100%" stopColor="#4F5BD5" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="20" height="20" rx="5.5" fill="url(#ig-grad)" />
      <rect
        x="6"
        y="6"
        width="12"
        height="12"
        rx="3.6"
        fill="none"
        stroke="white"
        strokeWidth="1.6"
      />
      <circle cx="12" cy="12" r="2.8" fill="none" stroke="white" strokeWidth="1.6" />
      <circle cx="16.6" cy="7.4" r="1" fill="white" />
    </svg>
  );
}

export function TelegramLogo({ className }: Props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-6", className)}>
      <circle cx="12" cy="12" r="10" fill="#229ED9" />
      <path
        d="M5.9 11.9 16.2 7.6c.5-.2 1 .1.8.8l-1.8 8.3c-.1.6-.5.7-1 .4l-2.7-2-1.3 1.3c-.2.2-.3.3-.6.3l.2-2.8 5-4.5c.2-.2 0-.3-.3-.1l-6.2 3.9-2.7-.8c-.6-.2-.6-.6.1-.9Z"
        fill="white"
      />
    </svg>
  );
}

export function FanvueLogo({ className }: Props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-6", className)}>
      <rect x="0" y="0" width="24" height="24" rx="5.5" fill="#49F264" />
      <path d="M13.00 5.88C14.21 5.85 18.90 5.83 20.12 5.88C21.35 5.92 20.31 6.00 20.38 6.12C20.44 6.25 20.58 6.44 20.50 6.62C20.42 6.81 20.77 7.04 19.88 7.25C18.98 7.46 16.21 7.58 15.12 7.88C14.04 8.17 13.67 8.69 13.38 9.00C13.08 9.31 13.27 9.48 13.38 9.75C13.48 10.02 13.48 10.33 14.00 10.62C14.52 10.92 16.02 11.23 16.50 11.50C16.98 11.77 16.94 12.02 16.88 12.25C16.81 12.48 16.98 12.54 16.12 12.88C15.27 13.21 12.75 13.77 11.75 14.25C10.75 14.73 10.73 15.04 10.12 15.75C9.52 16.46 8.65 18.04 8.12 18.50C7.60 18.96 7.21 18.60 7.00 18.50C6.79 18.40 6.81 18.25 6.88 17.88C6.94 17.50 7.31 16.81 7.38 16.25C7.44 15.69 7.40 14.92 7.25 14.50C7.10 14.08 7.00 14.00 6.50 13.75C6.00 13.50 4.69 13.23 4.25 13.00C3.81 12.77 3.83 12.60 3.88 12.38C3.92 12.15 3.83 11.90 4.50 11.62C5.17 11.35 7.08 11.02 7.88 10.75C8.67 10.48 8.75 10.40 9.25 10.00C9.75 9.60 10.40 8.96 10.88 8.38C11.35 7.79 11.79 6.90 12.12 6.50C12.46 6.10 12.73 6.10 12.88 6.00C13.02 5.90 11.79 5.90 13.00 5.88Z" fill="#151515" />
    </svg>
  );
}

export function PlatformLogo({
  platform,
  className,
}: {
  platform: "INSTAGRAM" | "TELEGRAM" | "FANVUE";
  className?: string;
}) {
  if (platform === "INSTAGRAM") return <InstagramLogo className={className} />;
  if (platform === "TELEGRAM") return <TelegramLogo className={className} />;
  return <FanvueLogo className={className} />;
}
