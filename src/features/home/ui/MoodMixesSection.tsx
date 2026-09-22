import { memo, useMemo, useState, useCallback } from "react";
import ScrollableRow from "@/shared/ui/ScrollableRow";
import { playerEngine } from "@/features/player";
import { usePlayerStore } from "@/features/player/store/playerStore";
import { useTranslation } from "@/languages";
import type { Track } from "@/shared/types";
import {
  FlashCircleFill,
  LeafFill,
  MoonFill,
  WaveFill,
  PlayFill,
} from "@mingcute/react";

type MoodDefinition = {
  id: string;
  labelKey: string;
  descKey: string;
  Icon: typeof FlashCircleFill;
  iconClass: string;
  gradient: string;
};

const MOODS: MoodDefinition[] = [
  {
    id: "energy",
    labelKey: "home.moodEnergy",
    descKey: "home.moodEnergyDesc",
    Icon: FlashCircleFill,
    iconClass: "text-amber-300",
    gradient: "from-amber-500/80 via-orange-600/70 to-red-700/80",
  },
  {
    id: "focus",
    labelKey: "home.moodFocus",
    descKey: "home.moodFocusDesc",
    Icon: LeafFill,
    iconClass: "text-emerald-300",
    gradient: "from-teal-500/80 via-emerald-600/70 to-green-800/80",
  },
  {
    id: "calm",
    labelKey: "home.moodCalm",
    descKey: "home.moodCalmDesc",
    Icon: WaveFill,
    iconClass: "text-sky-300",
    gradient: "from-sky-500/80 via-blue-600/70 to-indigo-800/80",
  },
  {
    id: "night",
    labelKey: "home.moodNight",
    descKey: "home.moodNightDesc",
    Icon: MoonFill,
    iconClass: "text-indigo-300",
    gradient: "from-violet-600/80 via-purple-700/70 to-fuchsia-900/80",
  },
];

// Deterministic shuffle so every mood produces a stable, distinct order
function seededShuffle<T>(items: T[], seed: number): T[] {
  const a = [...items];
  let s = seed;
  const rand = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface MoodMixCardProps {
  mood: MoodDefinition;
  tracks: Track[];
}

function MoodMixCard({ mood, tracks }: MoodMixCardProps) {
  const { t } = useTranslation();
  const [isCardHovered, setIsCardHovered] = useState(false);
  const trackDoubleClickBehavior = usePlayerStore(
    (state) => state.trackDoubleClickBehavior,
  );
  const label = t(mood.labelKey);
  const description = t(mood.descKey);

  const handlePlay = useCallback(() => {
    if (tracks.length === 0) return;
    const firstTrack = tracks[0];
    if (!firstTrack) return;
    void playerEngine.playTrack(
      firstTrack,
      tracks,
      `${label} · ${t("home.moodMixesSubtitle")}`,
      firstTrack.coverUrl,
    );
  }, [tracks, label, t]);

  const handleDoubleClick = useCallback(() => {
    if (trackDoubleClickBehavior === "queue") {
      for (const track of tracks) {
        playerEngine.addToQueue({
          id: track.id,
          title: track.title,
          artists: track.artists,
          coverUrl: track.coverUrl,
          durationMs: track.durationMs,
          playCount: track.playCount ?? 0,
        });
      }
    } else {
      handlePlay();
    }
  }, [trackDoubleClickBehavior, tracks, handlePlay]);

  const handleClick = (e: React.MouseEvent) => {
    const detail = (e as React.MouseEvent<HTMLDivElement>).detail;
    if (detail >= 2) {
      handleDoubleClick();
      return;
    }
    handlePlay();
  };

  return (
    <div
      className="group flex-shrink-0 w-[175px] cursor-pointer select-none"
      onClick={handleClick}
      onMouseEnter={() => setIsCardHovered(true)}
      onMouseLeave={() => setIsCardHovered(false)}
    >
      <div
        className={`relative aspect-square w-full overflow-hidden rounded-md bg-gradient-to-br ${mood.gradient} transition-all duration-300 group-hover:brightness-[1.12] shadow-md`}
      >
        <mood.Icon
          size={44}
          className={`${mood.iconClass} absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 drop-shadow-lg`}
        />
        <div className="absolute bottom-[8px] left-[10px]">
          <span className="text-[12px] font-semibold text-white/90 drop-shadow">
            {tracks.length} {t("library.tracks")}
          </span>
        </div>
        <div
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-150 ${
            isCardHovered ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="flex items-center justify-center w-[46px] h-[46px] rounded-full bg-black/70">
            <PlayFill size={20} className="text-white ml-[2px]" />
          </div>
        </div>
      </div>

      <div className="flex flex-col mt-[8px]">
        <span className="truncate text-[14px] font-[500] text-text-primary">
          {label}
        </span>
        <span className="truncate text-[13px] text-text-tertiary">
          {description}
        </span>
      </div>
    </div>
  );
}

export interface MoodMixesSectionProps {
  tracks: Track[];
  fallbackTracks?: Track[];
  headingMarginTop?: string;
}

function MoodMixesSection({
  tracks,
  fallbackTracks = [],
  headingMarginTop = "mt-[22px]",
}: MoodMixesSectionProps) {
  const { t } = useTranslation();

  const playableTracks = useMemo(() => {
    const liked = tracks.filter((tr) => tr.id && tr.title && tr.durationMs > 0);
    if (liked.length >= 3) return liked;
    const fallback = fallbackTracks.filter(
      (tr) => tr.id && tr.title && tr.durationMs > 0,
    );
    const seen = new Set(liked.map((tr) => tr.id));
    for (const tr of fallback) {
      if (seen.has(tr.id)) continue;
      liked.push(tr);
      seen.add(tr.id);
      if (liked.length >= 24) break;
    }
    return liked;
  }, [tracks, fallbackTracks]);

  const mixes = useMemo(() => {
    const pool = playableTracks.slice(0, 60);
    if (pool.length < 3) return [];
    return MOODS.map((mood, index) => ({
      mood,
      tracks: seededShuffle(pool, index + 42).slice(0, 24),
    }));
  }, [playableTracks]);

  if (mixes.length === 0) return null;

  return (
    <div className="flex flex-col">
      <div className={`${headingMarginTop} px-8 flex items-center justify-between`}>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center shrink-0">
            <WaveFill className="w-5 h-5 text-cyan-400" />
          </div>
          <h2
            className="text-text-primary text-[21px] font-semibold m-0 leading-tight tracking-tight"
            style={{ fontFamily: "var(--font-inter), sans-serif" }}
          >
            {t("home.moodMixes") || "Mood Mixes"}
          </h2>
        </div>
      </div>

      <ScrollableRow className="flex gap-[28px] pl-8 pr-8 mt-[12px] overflow-x-auto pb-[2px]">
        {mixes.map(({ mood, tracks: moodTracks }) => (
          <MoodMixCard
            key={`mood-mix-${mood.id}`}
            mood={mood}
            tracks={moodTracks}
          />
        ))}
      </ScrollableRow>
    </div>
  );
}

export default memo(MoodMixesSection);