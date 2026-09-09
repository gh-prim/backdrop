"use client";

import { useActionState, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { schedulePublicationAction, type ActionResult } from "@/app/actions/publications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MediaThumb } from "@/components/media-thumb";
import { AudioPicker, type SelectedAudio } from "@/components/audio-picker";
import { cn } from "cn";

type Rating = "SFW" | "SUGGESTIVE" | "NSFW";

type ChannelOption = {
  id: string;
  platform: string;
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
const STEPS = [
  { key: "schedule", label: "Schedule" },
  { key: "name", label: "Name" },
  { key: "channels", label: "Channels" },
  { key: "media", label: "Media" },
  { key: "publish", label: "Caption and send" },
] as const;

function defaultScheduledAt(): string {
  const at = new Date(Date.now() + 60 * 60 * 1000);
  at.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function ComposerForm({
  personaName,
  channels,
  variants,
}: {
  personaName: string;
  channels: ChannelOption[];
  variants: VariantOption[];
}) {
  const [step, setStep] = useState(0);

  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt);
  const [publishNow, setPublishNow] = useState(false);
  const [name, setName] = useState("");
  const [channelIds, setChannelIds] = useState<string[]>([]);
  const [kind, setKind] = useState("SINGLE");
  const [selected, setSelected] = useState<string[]>([]);
  const [caption, setCaption] = useState("");
  const [audio, setAudio] = useState<SelectedAudio | null>(null);

  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    schedulePublicationAction,
    null,
  );

  const chosenChannels = channels.filter((channel) => channelIds.includes(channel.id));

  /** Le catalogue audio est interrogé avec les credentials du compte choisi. */
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

  const stepValid = [
    Boolean(scheduledAt) || publishNow,
    name.trim().length > 0,
    channelIds.length > 0,
    selected.length > 0,
    true,
  ][step];

  const isLast = step === STEPS.length - 1;

  return (
    <form action={action} className="space-y-4">
      {/* Tout l'état du wizard est réémis à la soumission finale. */}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="scheduledAt" value={scheduledAt} />
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
      {selected.map((id) => (
        <input key={id} type="hidden" name="variantIds" value={id} />
      ))}

      <Stepper step={step} onJump={setStep} maxReached={step} />

      <Card>
        <CardContent className="min-h-64 space-y-4 pt-6">
          {step === 0 && (
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

          {step === 1 && (
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

          {step === 2 && (
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
                      <span className="font-medium">{channel.platform}</span>
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

          {step === 3 && (
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
                <span className="text-xs text-muted-foreground">
                  {selected.length} selected
                  {kind === "CAROUSEL" && " — up to 10, in the order you pick"}
                </span>
              </div>

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

              {kind === "REEL" && instagramChannel && (
                <AudioPicker
                  channelAccountId={instagramChannel.id}
                  selected={audio}
                  onSelect={setAudio}
                />
              )}

              {kind === "CAROUSEL" && (
                <p className="text-xs text-muted-foreground">
                  A carousel cannot carry music: the API exposes no audio parameter
                  outside Reels.
                </p>
              )}

              {variants.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No variant derived for this persona yet. Go through the Library.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {variants.map((variant) => {
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
            </div>
          )}

          {step === 4 && (
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
                  {caption.length} / 2200
                </p>
              </div>

              <dl className="grid gap-x-6 gap-y-1 border-t pt-3 text-xs sm:grid-cols-2">
                <Recap label="Name" value={name} />
                <Recap
                  label="Schedule"
                  value={
                    publishNow
                      ? "immediate"
                      : new Date(scheduledAt).toLocaleString("en-GB", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
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
                {audio && (
                  <Recap label="Music" value={`${audio.title} — ${audio.artist}`} />
                )}
                <Recap
                  label="Publications created"
                  value={`${chosenChannels.length}`}
                />
              </dl>
            </div>
          )}
        </CardContent>
      </Card>

      {state && !state.ok && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.ok && <p className="text-sm text-muted-foreground">{state.message}</p>}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={step === 0}
          onClick={() => setStep((s) => s - 1)}
        >
          <ChevronLeft className="size-4" />
          Back
        </Button>

        {!isLast ? (
          <Button
            type="button"
            disabled={!stepValid}
            onClick={() => setStep((s) => s + 1)}
          >
            Next
            <ChevronRight className="size-4" />
          </Button>
        ) : (
          <Button
            type="submit"
            name={publishNow ? "publishNow" : undefined}
            value={publishNow ? "1" : undefined}
            disabled={pending || selected.length === 0 || channelIds.length === 0}
          >
            {pending ? "Sending…" : publishNow ? "Publish now" : "Schedule"}
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
  step,
  maxReached,
  onJump,
}: {
  step: number;
  maxReached: number;
  onJump: (index: number) => void;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs">
      {STEPS.map((entry, index) => {
        const done = index < step;
        const current = index === step;
        return (
          <li key={entry.key} className="flex items-center gap-1">
            <button
              type="button"
              disabled={index > maxReached}
              onClick={() => onJump(index)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 transition",
                current && "bg-accent font-medium text-foreground",
                !current && "text-muted-foreground",
                index <= maxReached && !current && "hover:text-foreground",
                index > maxReached && "cursor-default opacity-50",
              )}
            >
              <span
                className={cn(
                  "flex size-4 items-center justify-center rounded-full border text-[9px]",
                  done && "border-primary bg-primary text-primary-foreground",
                  current && "border-primary",
                )}
              >
                {done ? <Check className="size-2.5" /> : index + 1}
              </span>
              {entry.label}
            </button>
            {index < STEPS.length - 1 && (
              <ChevronRight className="size-3 text-muted-foreground/50" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
