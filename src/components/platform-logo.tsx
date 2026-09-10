import { cn } from "cn";

/**
 * Marques des plateformes, en SVG intégrés.
 *
 * Aucune requête réseau: un logo distant échouerait hors ligne et ferait fuiter
 * la navigation de l'opérateur vers un tiers.
 *
 * Fanvue n'a pas de glyphe public établi comme Instagram ou Telegram: son
 * monogramme est une approximation assumée, à remplacer si la marque en publie
 * un officiel.
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
      <rect x="2" y="2" width="20" height="20" rx="5.5" fill="#0B0B0F" />
      <path
        d="M9 17V7.8c0-.5.4-.8.9-.8H15v2.4h-3.6v2.3H15v2.4h-3.6V17H9Z"
        fill="white"
      />
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
