"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { schedulePublicationAction, type ActionResult } from "@/app/actions/publications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MediaThumb } from "@/components/media-thumb";
import { AudioPicker, type SelectedAudio } from "@/components/audio-picker";
import { AlbumPicker } from "@/components/album-picker";
import { HashtagPicker } from "@/components/hashtag-picker";
import { HASHTAG_LIMIT, extractHashtags } from "@/lib/hashtags-shared";
import { reduceAlbumPick } from "@/lib/albums-shared";
import { cn } from "cn";
import { PlatformLogo } from "@/components/platform-logo";
import { TelegramTargetPicker } from "./telegram-target";

type Rating = "SFW" | "SUGGESTIVE" | "NSFW";

type ChannelOption = {
  id: string;
  // Typé plutôt que `string`: le panneau par canal choisit son contenu et son
  // logo d'après cette valeur, et une faute de frappe passerait inaperçue.
  platform: "INSTAGRAM" | "TELEGRAM" | "FANVUE";
  maxRating: Rating;
  state: string;
};

type VariantOption = {
  id: string;
  ratio: string;
  rating: Rating;
  hasPublicUrl: boolean;
  isVideo: boolean;
};

const RATING_RANK: Record<Rating, number> = { SFW: 0, SUGGESTIVE: 1, NSFW: 2 };

/**
 * Composer en assistant.
 *
 * L'ordre des étapes n'est pas cosmétique: les **canaux sont choisis avant les
 * médias**. C'est ce qui permet de dire « ce média est interdit ici, et voici
 * lequel de tes canaux l'interdit » au moment du choix, plutôt que de griser
 * un canal après coup sans que l'opérateur sache quoi corriger. C'est la
 * couche pédagogique du garde-fou de la section 9, dans le bon sens de lecture.
 */
/**
 * Étapes communes à tout envoi.
 *
 * Chaque canal coché ajoute ensuite la sienne (voir `useSteps`): les réglages
 * d'Instagram n'ont rien à faire devant quelqu'un qui ne publie que sur
 * Telegram, et les empiler dans une étape fourre-tout revenait à demander de
 * les trier soi-même.
 *
 * La description passe **avant** les étapes par canal: elle est commune à tout
 * l'envoi, et le panneau de hashtags d'Instagram l'analyse — il serait vide si
 * elle venait après.
 */
const BASE_STEPS = [
  { key: "schedule", label: "Schedule" },
  { key: "name", label: "Name" },
  { key: "channels", label: "Channels" },
  { key: "media", label: "Media" },
  { key: "caption", label: "Caption" },
] as const;

const PLATFORM_LABEL: Record<string, string> = {
  INSTAGRAM: "Instagram",
  TELEGRAM: "Telegram",
  FANVUE: "Fanvue",
};

/**
 * Valeur du champ `datetime-local`, au format que l'élément attend.
 *
 * Construit à la main plutôt que par `toISOString()`: celui-ci renvoie de
 * l'UTC, que le navigateur afficherait tel quel comme une heure locale.
 */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultScheduledAt(): string {
  const at = new Date(Date.now() + 60 * 60 * 1000);
  at.setSeconds(0, 0);
  return toLocalInput(at);
}

export function ComposerForm({
  personaId,
  personaName,
  channels,
  variants,
  initialScheduledAt,
}: {
  personaId: string;
  personaName: string;
  channels: ChannelOption[];
  variants: VariantOption[];
  /** Créneau choisi dans le calendrier, en ISO. */
  initialScheduledAt?: string;
}) {
  const [step, setStep] = useState(0);

  // Le créneau cliqué dans le calendrier gagne sur le défaut « dans une heure ».
  const [scheduledAt, setScheduledAt] = useState(() => {
    if (!initialScheduledAt) return defaultScheduledAt();
    const parsed = new Date(initialScheduledAt);
    return Number.isNaN(parsed.getTime())
      ? defaultScheduledAt()
      : toLocalInput(parsed);
  });
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramTargetLabel, setTelegramTargetLabel] = useState("");
  const [starPrice, setStarPrice] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [publishNow, setPublishNow] = useState(false);
  const [name, setName] = useState("");
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [kind, setKind] = useState("SINGLE");
  const [selected, setSelected] = useState<string[]>([]);
  const [ratioFilter, setRatioFilter] = useState("all");
  /** Choisir les médias un par un, ou envoyer un album déjà constitué. */
  const [mediaSource, setMediaSource] = useState<"media" | "album">("media");
  /** Bilan du dernier album appliqué: ce qui est entré, et ce qui a été écarté. */
  const [albumNote, setAlbumNote] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [caption, setCaption] = useState("");
  const [audio, setAudio] = useState<SelectedAudio | null>(null);

  /**
   * Le bouton d'envoi est désarmé un court instant à l'arrivée sur la dernière
   * étape. Sans cela, un double clic sur « Next » publiait: le second clic
   * tombait sur le bouton d'envoi qui venait d'apparaître.
   */
  const [armed, setArmed] = useState(true);
  const [dryRun, setDryRun] = useState(false);
  const router = useRouter();

  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    schedulePublicationAction,
    null,
  );

  /**
   * Une fois la publication acceptée, le composeur a fini son travail.
   *
   * Retenir l'opérateur devant une barre de progression serait doublement
   * faux: la barre de tâches du haut suit déjà l'envoi et le notifiera à
   * l'arrivée, et rester là laisse croire qu'il faut surveiller — alors que
   * fermer l'onglet ne changerait rien, le workflow tournant côté serveur.
   *
   * On rend donc la main: retour aux publications, où l'envoi apparaît avec
   * son état réel.
   */
  useEffect(() => {
    if (!state?.ok) return;
    const timer = setTimeout(() => router.push("/publications"), 900);
    return () => clearTimeout(timer);
  }, [state, router]);

  const chosenChannels = channels.filter((channel) => channelIds.includes(channel.id));

  /** Le catalogue audio est interrogé avec les credentials du compte choisi. */
  const telegramChannel = chosenChannels.find(
    (channel) => channel.platform === "TELEGRAM",
  );
  const instagramChannel = chosenChannels.find(
    (channel) => channel.platform === "INSTAGRAM",
  );

  /**
   * Rating maximal admissible: le **plus restrictif** des canaux choisis.
   * Publier sur Instagram et Telegram en même temps aligne donc tout le monde
   * sur la contrainte d'Instagram.
   */
  const allowedRating = useMemo<Rating>(() => {
    if (chosenChannels.length === 0) return "NSFW";
    return chosenChannels.reduce<Rating>(
      (min, channel) =>
        RATING_RANK[channel.maxRating] < RATING_RANK[min] ? channel.maxRating : min,
      "NSFW",
    );
  }, [chosenChannels]);

  const restrictingChannels = chosenChannels.filter(
    (channel) => channel.maxRating === allowedRating,
  );

  function isBlocked(variant: VariantOption) {
    return RATING_RANK[variant.rating] > RATING_RANK[allowedRating];
  }

  const blockedCount = variants.filter(isBlocked).length;

  /** Ratios réellement présents: proposer 1:1 quand rien ne l'est n'aide pas. */
  const availableRatios = useMemo(
    () => [...new Set(variants.map((variant) => variant.ratio))].sort(),
    [variants],
  );

  const shownVariants = useMemo(
    () =>
      variants.filter((variant) => {
        if (ratioFilter !== "all" && variant.ratio !== ratioFilter) return false;
        if (typeFilter === "image" && variant.isVideo) return false;
        if (typeFilter === "video" && !variant.isVideo) return false;
        return true;
      }),
    [variants, ratioFilter, typeFilter],
  );

  /** Un Reel sur une photo déclenche un rendu vidéo au moment de la publication. */
  const selectionIsVideo = selected.every(
    (id) => variants.find((v) => v.id === id)?.isVideo,
  );

  function toggleChannel(id: string) {
    setChannelIds((current) => {
      const next = current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id];
      // Un média devenu interdit par le nouveau choix de canaux est retiré
      // de la sélection, plutôt que de rester et de faire échouer l'envoi.
      const nextAllowed = channels
        .filter((c) => next.includes(c.id))
        .reduce<Rating>(
          (min, c) => (RATING_RANK[c.maxRating] < RATING_RANK[min] ? c.maxRating : min),
          "NSFW",
        );
      setSelected((chosen) =>
        chosen.filter((variantId) => {
          const variant = variants.find((v) => v.id === variantId);
          return variant && RATING_RANK[variant.rating] <= RATING_RANK[nextAllowed];
        }),
      );
      return next;
    });
  }

  function toggleVariant(variant: VariantOption) {
    if (isBlocked(variant)) return;
    setSelected((current) =>
      current.includes(variant.id)
        ? current.filter((x) => x !== variant.id)
        : kind === "CAROUSEL"
          ? [...current, variant.id]
          : [variant.id],
    );
  }

  const CAROUSEL_MAX = 10;

  /**
   * Un album devient une sélection de médias.
   *
   * Le filtre de rating est réappliqué **ici** et non côté serveur de l'album:
   * l'album ignore les canaux, et un média classé au-dessus de ce que le plus
   * restrictif accepte ne doit pas entrer dans la sélection par la bande. On
   * le retire et on le dit, plutôt que de laisser l'envoi échouer plus tard.
   */
  function applyAlbum({
    variantIds,
    ratio,
    albumName,
    missing,
  }: {
    variantIds: string[];
    ratio: string;
    albumName: string;
    missing: number;
  }) {
    const { kept, blocked, overflow, unknown } = reduceAlbumPick(
      variantIds,
      (id) => variants.find((variant) => variant.id === id)?.rating,
      allowedRating,
      CAROUSEL_MAX,
    );

    const dropped: string[] = [];
    if (missing > 0) dropped.push(`${missing} without a ${ratio} variant`);
    if (blocked > 0) dropped.push(`${blocked} above ${allowedRating}`);
    if (overflow > 0) dropped.push(`${overflow} beyond the ${CAROUSEL_MAX}-media limit`);
    // Une variante inconnue du composeur n'est pas publiable pour cette
    // persona: le taire ferait un album amputé sans raison visible.
    if (unknown > 0) dropped.push(`${unknown} not publishable here`);

    const tail = dropped.length > 0 ? ` Left out: ${dropped.join(", ")}.` : "";

    if (kept.length === 0) {
      setAlbumNote(`Nothing selected from “${albumName}”.${tail}`);
      return;
    }

    setSelected(kept);
    // Plusieurs médias, c'est un carrousel: laisser « Single post » n'enverrait
    // que le premier sans le dire.
    if (kept.length > 1 && kind !== "CAROUSEL") setKind("CAROUSEL");
    if (kept.length === 1 && kind === "CAROUSEL") setKind("SINGLE");
    setRatioFilter(ratio);
    setMediaSource("media");
    setAlbumNote(`“${albumName}” in ${ratio}: ${kept.length} media selected.${tail}`);
  }

  /**
   * Hashtags tapés dans la légende commune.
   *
   * Ils comptent dans le même plafond que ceux choisis dans l'onglet Instagram,
   * et partent vers **tous** les canaux — Telegram compris, où une traîne de
   * croisillons n'a aucun sens. Le signaler à la frappe évite de le découvrir
   * au moment de l'envoi.
   */
  const typedHashtags = useMemo(() => extractHashtags(caption), [caption]);
  const totalHashtagCount = useMemo(
    () => new Set([...typedHashtags, ...hashtags]).size,
    [typedHashtags, hashtags],
  );
  const hashtagsOverflow = totalHashtagCount > HASHTAG_LIMIT;

  const steps = useMemo(
    () => [
      ...BASE_STEPS.map((entry) => ({ ...entry, channel: null as ChannelOption | null })),
      ...chosenChannels.map((channel) => ({
        key: `channel:${channel.id}`,
        label: PLATFORM_LABEL[channel.platform] ?? channel.platform,
        channel,
      })),
    ],
    [chosenChannels],
  );

  // Décocher un canal retire son étape: rester dessus laisserait l'écran sur
  // des réglages qui ne concernent plus personne.
  const stepIndex = Math.min(step, steps.length - 1);
  const currentStep = steps[stepIndex];

  const stepValid =
    currentStep.key === "schedule"
      ? Boolean(scheduledAt) || publishNow
      : currentStep.key === "name"
        ? name.trim().length > 0
        : currentStep.key === "channels"
          ? channelIds.length > 0
          : currentStep.key === "media"
            ? selected.length > 0
            : currentStep.key === "caption"
              ? !hashtagsOverflow
              : true;

  const isLast = stepIndex === steps.length - 1;

  function goToStep(target: number) {
    const clamped = Math.max(0, Math.min(target, steps.length - 1));
    setStep(clamped);
    if (clamped === steps.length - 1) {
      setArmed(false);
      setTimeout(() => setArmed(true), 600);
    }
  }

  return (
    <form action={action} className="flex min-h-0 flex-1 flex-col gap-4">
      {/* Tout l'état du wizard est réémis à la soumission finale. */}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="scheduledAt" value={scheduledAt} />
      {dryRun && <input type="hidden" name="dryRun" value="1" />}
      {/* Concaténés à la légende de la seule publication Instagram, côté
          serveur: la légende commune reste propre pour les autres canaux. */}
      {hashtags.map((name) => (
        <input key={name} type="hidden" name="hashtags" value={name} />
      ))}
      <input type="hidden" name="audioId" value={audio?.audioId ?? ""} />
      <input
        type="hidden"
        name="audioVolume"
        value={audio ? String(audio.audioVolume) : ""}
      />
      <input
        type="hidden"
        name="videoVolume"
        value={audio ? String(audio.videoVolume) : ""}
      />
      {channelIds.map((id) => (
        <input key={id} type="hidden" name="channelAccountIds" value={id} />
      ))}
      {/* Hors des étapes: chacune est démontée en la quittant, et un champ
          qui n'existe plus au moment de l'envoi n'est pas soumis. */}
      {telegramChannel && (
        <>
          <input type="hidden" name="telegramChatId" value={telegramChatId} />
          <input
            type="hidden"
            name="telegramTargetLabel"
            value={telegramTargetLabel}
          />
          <input type="hidden" name="starPrice" value={starPrice} />
        </>
      )}
      {selected.map((id) => (
        <input key={id} type="hidden" name="variantIds" value={id} />
      ))}

      <Stepper steps={steps} step={stepIndex} onJump={goToStep} maxReached={stepIndex} />

      {/* `min-h` plutôt qu'une hauteur pleine: une étape à un seul champ ne
          doit pas s'afficher dans un cadre vide, ni le cadre sauter d'une
          étape à l'autre. */}
      {/* Pas d'`items-start` ici: la colonne de contenu doit s'étirer pour que
          son `overflow-y-auto` ait une hauteur à respecter, faute de quoi elle
          déborde et passe sous le pied de page. Le récapitulatif se cale seul
          avec `self-start`. */}
      <div className="grid min-h-[15rem] flex-1 gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          {currentStep.key === "schedule" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="scheduledAtInput">Date and time</Label>
                <Input
                  id="scheduledAtInput"
                  type="datetime-local"
                  value={scheduledAt}
                  disabled={publishNow}
                  onChange={(event) => setScheduledAt(event.target.value)}
                  className="h-8 w-56"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={publishNow}
                  onChange={(event) => setPublishNow(event.target.checked)}
                />
                Publish right away
              </label>
              <p className="text-xs text-muted-foreground">
                The clock stays on the application side. A publication running later
                than the tolerance window does not go out: it waits for your call.
              </p>
            </div>
          )}

          {currentStep.key === "name" && (
            <div className="space-y-1.5">
              <Label htmlFor="nameInput">Publication name</Label>
              <Input
                id="nameInput"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Park yoga session — September"
                className="h-8 w-full max-w-lg"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Internal label, never published. It ties together the sibling
                publications of one multi-channel send.
              </p>
            </div>
          )}

          {currentStep.key === "channels" && (
            <div className="space-y-3">
              <Label>Channels — {personaName}</Label>
              {channels.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No channel connected for this persona.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {channels.map((channel) => {
                  const active = channelIds.includes(channel.id);
                  return (
                    <button
                      key={channel.id}
                      type="button"
                      onClick={() => toggleChannel(channel.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition",
                        active && "border-primary bg-accent",
                      )}
                    >
                      {active && <Check className="size-3.5" />}
                      <PlatformLogo platform={channel.platform} className="size-4" />
                      <span className="font-medium">
                        {PLATFORM_LABEL[channel.platform] ?? channel.platform}
                      </span>
                      <Badge variant="outline" className="h-4 px-1 text-[9px]">
                        max {channel.maxRating}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{channel.state}</span>
                    </button>
                  );
                })}
              </div>
              {chosenChannels.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  One publication is created per channel: a failure on one does not
                  bring down the others.
                </p>
              )}
            </div>
          )}

          {currentStep.key === "media" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="kindSelect">Type</Label>
                  <select
                    id="kindSelect"
                    value={kind}
                    onChange={(event) => {
                      setKind(event.target.value);
                      setSelected((current) =>
                        event.target.value === "CAROUSEL" ? current : current.slice(0, 1),
                      );
                    }}
                    className="h-8 rounded-md border bg-transparent px-2 text-sm"
                  >
                    <option value="SINGLE">Single post</option>
                    <option value="CAROUSEL">Carousel</option>
                    <option value="REEL">Reel</option>
                  </select>
                </div>
                <div className="flex gap-1 rounded-md border p-0.5 text-xs">
                  {[
                    ["media", "Media"],
                    ["album", "Albums"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setMediaSource(value as "media" | "album")}
                      className={cn(
                        "rounded px-2 py-1 transition-colors",
                        mediaSource === value
                          ? "bg-accent font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <span className="text-xs text-muted-foreground">
                  {selected.length} selected
                  {kind === "CAROUSEL" && " — up to 10, in the order you pick"}
                </span>
              </div>

              {albumNote && (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                  {albumNote}
                </p>
              )}

              {mediaSource === "album" ? (
                // L'album est un raccourci de sélection, pas un autre type
                // d'envoi: il repose la sélection dans la grille, où elle reste
                // ajustable avant la légende.
                <AlbumPicker personaId={personaId} onPick={applyAlbum} />
              ) : (
                <>

              {(kind === "SINGLE" || (kind === "REEL" && !selectionIsVideo)) &&
                instagramChannel && (
                  <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={kind === "REEL"}
                      onChange={(event) => {
                        // Poser une musique sur une photo n'est possible qu'en
                        // Reel: l'API n'accepte aucun audio sur un container
                        // IMAGE (4.1.5). Le choix est donc présenté tel qu'il
                        // est — avec sa conséquence, pas comme une case isolée.
                        setKind(event.target.checked ? "REEL" : "SINGLE");
                        if (!event.target.checked) setAudio(null);
                        setSelected((current) => current.slice(0, 1));
                      }}
                    />
                    <span>
                      Add music
                      <span className="block text-xs text-muted-foreground">
                        The photo becomes a Reel: it will be rendered as an 8-second
                        video, and Instagram supplies the track. A photo published as
                        such cannot carry music.
                      </span>
                    </span>
                  </label>
                )}

              {blockedCount > 0 && (
                // La couche pédagogique: on nomme le canal qui interdit, pas
                // seulement le fait que ce soit interdit (6.1).
                <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {blockedCount} media unavailable:{" "}
                    {restrictingChannels.map((c) => c.platform).join(", ")} only accepts{" "}
                    {allowedRating}. Remove that channel at the previous step to reach
                    them.
                  </span>
                </p>
              )}

              {kind === "CAROUSEL" && (
                <p className="text-xs text-muted-foreground">
                  A carousel cannot carry music: the API exposes no audio parameter
                  outside Reels.
                </p>
              )}

              {variants.length > 0 && (
                // Le ratio commande le cadrage publié: pouvoir isoler le 9:16
                // avant de choisir évite de sélectionner un 4:5 pour un Reel.
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex gap-1 rounded-md border p-0.5 text-xs">
                    {["all", ...availableRatios].map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => setRatioFilter(ratio)}
                        className={cn(
                          "rounded px-2 py-1 transition-colors",
                          ratioFilter === ratio
                            ? "bg-accent font-medium text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {ratio === "all" ? "All ratios" : ratio}
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-1 rounded-md border p-0.5 text-xs">
                    {[
                      ["all", "All types"],
                      ["image", "Images"],
                      ["video", "Videos"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setTypeFilter(value)}
                        className={cn(
                          "rounded px-2 py-1 transition-colors",
                          typeFilter === value
                            ? "bg-accent font-medium text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <span className="ml-auto text-xs text-muted-foreground">
                    {shownVariants.length} of {variants.length}
                  </span>
                </div>
              )}

              {variants.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No variant derived for this persona yet. Go through the Library.
                </p>
              ) : shownVariants.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No variant matches these filters.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {shownVariants.map((variant) => {
                    const index = selected.indexOf(variant.id);
                    const blocked = isBlocked(variant);
                    return (
                      <div
                        key={variant.id}
                        role="checkbox"
                        aria-checked={index >= 0}
                        aria-disabled={blocked}
                        tabIndex={blocked ? -1 : 0}
                        onClick={() => toggleVariant(variant)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleVariant(variant);
                          }
                        }}
                        title={
                          blocked
                            ? `${variant.rating} media: blocked on ${restrictingChannels.map((c) => c.platform).join(", ")}`
                            : undefined
                        }
                        className={cn(
                          "relative rounded-md ring-offset-2 ring-offset-background transition",
                          blocked
                            ? "cursor-not-allowed opacity-35 grayscale"
                            : "cursor-pointer",
                          index >= 0 && "ring-2 ring-primary",
                        )}
                      >
                        <MediaThumb
                          variantId={variant.id}
                          rating={variant.rating}
                          ratio={variant.ratio}
                          className="aspect-[4/5]"
                        />
                        {index >= 0 && kind === "CAROUSEL" && (
                          <span className="absolute right-1 top-1 rounded bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                            {index + 1}
                          </span>
                        )}
                        {!variant.hasPublicUrl && !blocked && (
                          <span className="absolute bottom-1 left-1 rounded bg-destructive px-1 text-[9px] text-destructive-foreground">
                            not on R2
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
                </>
              )}
            </div>
          )}

          {currentStep.key === "caption" && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="captionInput">Caption</Label>
                <textarea
                  id="captionInput"
                  name="caption"
                  rows={4}
                  maxLength={2200}
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  className="w-full rounded-md border bg-transparent p-2 text-sm"
                  placeholder="2200 characters maximum on Instagram."
                />
                <p className="text-xs text-muted-foreground">
                  {caption.length} / 2200 · shared by every channel of this send
                </p>

                {typedHashtags.length > 0 && (
                  <p
                    className={cn(
                      "flex items-start gap-1.5 rounded-md border p-2 text-xs",
                      hashtagsOverflow
                        ? "border-destructive/50 text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      {typedHashtags.length} hashtag
                      {typedHashtags.length > 1 ? "s" : ""} typed here
                      {hashtags.length > 0 && ` + ${hashtags.length} picked`} ={" "}
                      {totalHashtagCount} / {HASHTAG_LIMIT}.
                      {hashtagsOverflow
                        ? " Remove some before going further."
                        : instagramChannel
                          ? " The Instagram tab is the place for them — from here they also reach every other channel."
                          : " They will be sent as plain text: no channel of this send reads hashtags."}
                    </span>
                  </p>
                )}
              </div>

            </div>
          )}

          {/* Une étape par canal choisi: ses réglages, et rien d'autre. */}
          {currentStep.channel && (
            <div className="space-y-4">
              {currentStep.channel.platform === "INSTAGRAM" && (
                <>
                  {kind === "REEL" ? (
                    <AudioPicker
                      channelAccountId={currentStep.channel.id}
                      selected={audio}
                      onSelect={setAudio}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Music is a Reel feature: the API exposes no audio parameter
                      elsewhere.
                    </p>
                  )}

                  <HashtagPicker
                    channelAccountId={currentStep.channel.id}
                    caption={caption}
                    selected={hashtags}
                    onChange={setHashtags}
                  />
                </>
              )}

              {currentStep.channel.platform === "TELEGRAM" && (
                <TelegramTargetPicker
                  channelAccountId={currentStep.channel.id}
                  chatId={telegramChatId}
                  onChatIdChange={(id, label) => {
                    setTelegramChatId(id);
                    setTelegramTargetLabel(label);
                  }}
                  starPrice={starPrice}
                  onStarPriceChange={setStarPrice}
                  mediaCount={selected.length}
                />
              )}

              {currentStep.channel.platform === "FANVUE" && (
                <p className="text-xs text-muted-foreground">
                  Fanvue lands in phase 4: audience and price will be set here.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Récapitulatif permanent: les choix restent lisibles pendant qu'on
            avance, ce qui remplace l'étape de relecture finale. Ancré en haut
            et sur toute la hauteur, pour ne pas flotter au milieu du vide. */}
        <aside className="hidden min-h-0 self-start overflow-y-auto md:block">
          {/* Hauteur au contenu: un panneau de trois lignes étiré sur toute la
              colonne se lit comme une boîte vide. */}
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              This send
            </p>
            <div className="space-y-1.5 text-xs">
              <Recap label="Name" value={name} />
              <Recap
                label="Schedule"
                value={
                  publishNow
                    ? "immediate"
                    : scheduledAt
                      ? new Date(scheduledAt).toLocaleString("en-GB", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : ""
                }
              />
              <Recap
                label="Channels"
                value={chosenChannels.map((c) => c.platform).join(", ")}
              />
              <Recap
                label="Type"
                value={
                  kind === "REEL" && !selectionIsVideo
                    ? "Reel (photo rendered as video)"
                    : kind
                }
              />
              <Recap label="Media" value={`${selected.length}`} />
              {audio && <Recap label="Music" value={`${audio.title} — ${audio.artist}`} />}
              <Recap label="Publications" value={`${chosenChannels.length}`} />
            </div>
          </div>
        </aside>
      </div>

      <div className="-mx-4 -mb-4 flex shrink-0 items-center gap-3 border-t bg-muted/30 px-4 py-3">
        <Button
          type="button"
          variant="ghost"
          disabled={stepIndex === 0}
          onClick={() => goToStep(stepIndex - 1)}
        >
          <ChevronLeft className="size-4" />
          Back
        </Button>

        {state && !state.ok && (
          <span className="text-sm text-destructive">{state.error}</span>
        )}
        {state?.ok && (
          <span className="text-sm text-muted-foreground">{state.message}</span>
        )}

        {isLast && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={(event) => setDryRun(event.target.checked)}
            />
            {/* Éprouver un envoi multi-canal sans rien publier: tout est
                vérifié — statut, échéance, rating, quota, destination — et
                l'appel plateforme n'a pas lieu. */}
            Dry run — check everything, send nothing
          </label>
        )}

        {!isLast && (
          <Button type="button" disabled={!stepValid} onClick={() => goToStep(stepIndex + 1)}>
            Next
            <ChevronRight className="size-4" />
          </Button>
        )}

        {isLast && (
          // Volontairement à l'opposé de « Next »: un clic répété au même
          // endroit ne doit jamais tomber sur une action irréversible.
          <Button
            type="submit"
            name={publishNow ? "publishNow" : undefined}
            value={publishNow ? "1" : undefined}
            className="ml-auto"
            disabled={
              !armed || pending || selected.length === 0 || channelIds.length === 0
            }
          >
            {pending
              ? "Sending…"
              : dryRun
                ? "Dry run"
                : publishNow
                  ? "Publish now"
                  : "Schedule"}
          </Button>
        )}
      </div>
    </form>
  );
}

function Recap({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value || "—"}</dd>
    </div>
  );
}

function Stepper({
  steps,
  step,
  maxReached,
  onJump,
}: {
  steps: { key: string; label: string; channel: ChannelOption | null }[];
  step: number;
  maxReached: number;
  onJump: (index: number) => void;
}) {
  return (
    // Même forme que les onglets d'une page de détail (6.1): pleine largeur,
    // soulignés. La différence est qu'un pas non atteint reste inaccessible.
    // Barre pleine largeur, adossée au bord du modal: le fil d'étapes est un
    // repère de navigation, pas un contenu — il doit se lire d'un trait.
    <ol className="-mx-4 -mt-2 flex w-[calc(100%+2rem)] items-stretch border-b bg-muted/30 px-4 text-sm">
      {steps.map((entry, index) => {
        const done = index < step;
        const current = index === step;
        const reachable = index <= maxReached;
        return (
          <li key={entry.key} className="flex-1">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onJump(index)}
              className={cn(
                "relative flex w-full items-center justify-center gap-2 px-2 py-2.5 transition-colors",
                current ? "font-medium text-foreground" : "text-muted-foreground",
                reachable && !current && "hover:text-foreground",
                !reachable && "cursor-default opacity-40",
                current && "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-foreground",
              )}
            >
              {/* Une étape de canal porte son logo plutôt qu'un numéro: on la
                  repère alors sans lire, ce qui compte quand il y en a trois. */}
              {entry.channel ? (
                <PlatformLogo platform={entry.channel.platform} className="size-5 shrink-0" />
              ) : (
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium",
                    done && "border-primary bg-primary text-primary-foreground",
                    current && "border-primary",
                  )}
                >
                  {done ? <Check className="size-3" /> : index + 1}
                </span>
              )}
              <span className="truncate">{entry.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
