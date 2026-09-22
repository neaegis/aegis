import { useEffect, useRef, useState } from "react";
import Button from "@/shared/ui/Button";
import TextInput from "@/shared/ui/TextInput";
import Tooltip from "@/shared/ui/Tooltip";
import { CheckLine, InformationLine, LinkLine } from "@mingcute/react";
import { useAddPlaylistTracks, useCreatePlaylist } from "../../hooks";
import { notifyLibraryChanged } from "../../hooks/usePlaylists";
import Dialog from "@/shared/ui/Dialog";
import { useToast } from "@/shared/ui";
import { useTranslation } from "@/languages";
import { useModalStore } from "../../store/modalStore";
import { useImportStore } from "../../store/importStore";
import { resolveApiErrorMessage } from "@/shared/api";
import { LocalImportError } from "../../import/parsers";
import type { SourceTrackSeed } from "../../import/parsers";
import {
  getSoundCloudTrending,
  soundCloudTrackToSeed,
} from "../../import/soundcloudClient";

type Tab = "create" | "import";

const TITLE_MAX = 20;

// mirrors backend detectImportSource, labels only
function detectSourceLabel(raw: string): string | null {
  try {
    let text = raw.trim();
    if (!text.startsWith("http://") && !text.startsWith("https://")) {
      text = `https://${text}`;
    }
    const host = new URL(text).hostname.toLowerCase().replace(/^www\./, "");
    if (["youtube.com", "music.youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return "YouTube";
    if (host === "soundcloud.com" || host.endsWith(".soundcloud.com")) return "SoundCloud";
    if (host === "open.spotify.com") return "Spotify";
    if (host === "deezer.com" || host.endsWith(".deezer.com")) return "Deezer";
    if (["music.apple.com", "geo.music.apple.com", "itunes.apple.com"].includes(host) || host.endsWith(".music.apple.com")) return "Apple Music";
  } catch {
    // not a url yet
  }
  return null;
}

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

export default function CreatePlaylistModal() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const open = useModalStore((state) => state.createPlaylistOpen);
  const initialUrl = useModalStore((state) => state.createPlaylistInitialUrl);
  const pendingTrack = useModalStore((state) => state.createPlaylistPendingTrack);
  const close = useModalStore((state) => state.closeCreatePlaylist);

  const [tab, setTab] = useState<Tab>("create");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [showDescription, setShowDescription] = useState(false);
  const [importUrl, setImportUrl] = useState("");

  const [importing, setImporting] = useState(false);
  const [createError, setCreateError] = useState("");
  const [importError, setImportError] = useState("");
  const [trendingTracks, setTrendingTracks] = useState<SourceTrackSeed[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(false);
  const [trendingError, setTrendingError] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const createPlaylist = useCreatePlaylist();
  const addTrack = useAddPlaylistTracks();

  const detectedSource = detectSourceLabel(importUrl);
  const isCreate = tab === "create";

  async function loadTrending() {
    setTrendingLoading(true);
    setTrendingError(false);
    const result = await getSoundCloudTrending(10);
    setTrendingLoading(false);
    if (result.ok) {
      setTrendingTracks(result.tracks.map(soundCloudTrackToSeed));
    } else {
      setTrendingError(true);
    }
  }

  useEffect(() => {
    if (open) {
      setTrendingTracks([]);
      setTrendingLoading(false);
      setTrendingError(false);
      void loadTrending();
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setTab(initialUrl ? "import" : "create");
      setTitle("");
      setDescription("");
      setShowDescription(false);
      setImportUrl(initialUrl || "");
      setCreateError("");
      setImportError("");
      requestAnimationFrame(() =>
        (initialUrl ? linkRef : titleRef).current?.focus(),
      );
    }
  }, [open, initialUrl]);

  async function handleCreate() {
    if (createPlaylist.isPending) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setCreateError(t("common.name_required"));
      return;
    }
    setCreateError("");
    try {
      const playlist = await createPlaylist.mutateAsync({
        title: trimmed.slice(0, TITLE_MAX),
        description: description.trim() || undefined,
      });
      notifyLibraryChanged();

      if (pendingTrack) {
        try {
          await addTrack.mutateAsync({ playlistId: playlist.id, track: pendingTrack });
          toast(t("common.added_to_playlist"), "checkmark", {
            description: playlist.title || trimmed,
          });
        } catch {
          toast(t("common.failed_add_playlist"), "error");
        }
      }

      close();
    } catch {
      setCreateError(t("common.failed_create_playlist"));
    }
  }

  async function handleImport(overrideUrl?: string) {
    if (importing) return;
    let target = (overrideUrl ?? importUrl).trim();
    if (!target) {
      setImportError(t("common.paste_link_first"));
      return;
    }

    if (!target.startsWith("http://") && !target.startsWith("https://")) {
      target = `https://${target}`;
    }

    try {
      new URL(target);
    } catch {
      setImportError(t("common.unsupported_link"));
      return;
    }

    setImportError("");
    setImporting(true);
    try {
      await useImportStore.getState().startImport(target, pendingTrack);
      close();
    } catch (err: unknown) {
      if (err instanceof LocalImportError) {
        setImportError(err.message);
      } else {
        setImportError(resolveApiErrorMessage(err, t, "common.failed_import_playlist"));
      }
    } finally {
      setImporting(false);
    }
  }

  async function handleSeedsImport(tracks: SourceTrackSeed[]) {
    if (importing || tracks.length === 0) return;
    setImportError("");
    setImporting(true);
    try {
      await useImportStore
        .getState()
        .importLocalSeeds(tracks, {
          source: "soundcloud",
          sourceUrl: "",
          title: t("import.popular_on_soundcloud"),
        });
      close();
    } catch (err: unknown) {
      if (err instanceof LocalImportError) {
        setImportError(err.message);
      } else {
        setImportError(resolveApiErrorMessage(err, t, "common.failed_import_playlist"));
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? close() : undefined)} maxWidth={440}>
      <div className="flex flex-col gap-[14px] px-[20px] pb-[16px]">
        <div>
          <h2 className="m-0 text-[18px] font-[500] text-text-primary" style={font}>
            {isCreate ? t("common.from_scratch") : t("common.import_playlist")}
          </h2>
          <p className="m-0 mt-[2px] text-[13px] text-text-tertiary" style={font}>
            {isCreate ? t("common.create_empty_playlist") : t("common.import_playlist_description")}
          </p>
        </div>

        <div className="flex p-[3px] rounded-lg bg-border-alpha-14">
          {(
            [
              { id: "create", label: t("common.from_scratch") },
              { id: "import", label: t("common.import") },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex-1 h-[30px] rounded-md text-[13px] font-[500] transition-all cursor-pointer border-none ${
                tab === item.id
                  ? "bg-bg-primary text-text-primary"
                  : "bg-transparent text-text-secondary hover:text-text-primary"
              }`}
              style={font}
            >
              {item.label}
            </button>
          ))}
        </div>

        {isCreate ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
            className="flex flex-col gap-[10px]"
          >
            <TextInput
              ref={titleRef}
              placeholder={t("common.playlist_name")}
              value={title}
              maxLength={TITLE_MAX}
              hasError={Boolean(createError)}
              onChange={(e) => {
                setTitle(e.target.value);
                if (createError) setCreateError("");
              }}
              disabled={createPlaylist.isPending}
              rightSlot={
                <span className="text-[11px] text-text-tertiary tabular-nums" style={font}>
                  {title.length}/{TITLE_MAX}
                </span>
              }
            />
            {showDescription ? (
              <textarea
                autoFocus
                placeholder={t("common.description_placeholder")}
                value={description}
                maxLength={300}
                rows={2}
                disabled={createPlaylist.isPending}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full resize-none rounded-md border border-border-primary bg-bg-primary px-[14px] py-[10px] text-[14px] font-[400] text-text-primary placeholder:text-text-tertiary outline-none transition-[border-color,box-shadow] duration-150 focus:border-text-secondary focus:ring-1 focus:ring-text-secondary disabled:opacity-50"
                style={font}
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowDescription(true)}
                className="self-start bg-transparent border-none p-0 text-[12px] text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
                style={font}
              >
                + {t("common.description_placeholder")}
              </button>
            )}
            {createError && (
              <span className="text-[12px] text-accent-primary" style={font}>
                {createError}
              </span>
            )}
            <div className="flex items-center justify-end gap-[8px] mt-[2px]">
              <Button type="button" variant="ghost" size="sm" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={createPlaylist.isPending}>
                {createPlaylist.isPending ? t("common.adding") : t("common.create")}
              </Button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleImport();
            }}
            className="flex flex-col gap-[10px]"
          >
            <TextInput
              ref={linkRef}
              icon={<LinkLine size={16} />}
              placeholder={t("common.paste_link_placeholder")}
              value={importUrl}
              hasError={Boolean(importError)}
              onChange={(e) => {
                setImportUrl(e.target.value);
                if (importError) setImportError("");
              }}
              disabled={importing}
              rightSlot={
                detectedSource ? (
                  <Tooltip content={detectedSource} side="top">
                    <span className="inline-flex cursor-default">
                      <CheckLine size={16} className="text-accent-primary" />
                    </span>
                  </Tooltip>
                ) : (
                  <Tooltip
                    side="top"
                    multiline
                    content={t("common.import_sources_hint")}
                  >
                    <span className="inline-flex text-text-tertiary hover:text-text-secondary transition-colors cursor-help">
                      <InformationLine size={16} />
                    </span>
                  </Tooltip>
                )
              }
            />
            {importError && (
              <span className="text-[12px] text-accent-primary" style={font}>
                {importError}
              </span>
            )}

            {(trendingLoading || trendingError || trendingTracks.length > 0) && (
              <div className="flex flex-col gap-[6px] rounded-lg border border-border-alpha-14 bg-border-alpha-10 px-[10px] py-[8px]">
                <div className="flex items-center justify-between gap-[8px]">
                  <div className="flex flex-col min-w-0">
                    <span
                      className="text-[12px] font-[600] text-text-primary"
                      style={font}
                    >
                      {t("import.popular_on_soundcloud")}
                    </span>
                    {!trendingLoading && trendingTracks.length > 0 && (
                      <span
                        className="text-[11px] text-text-tertiary truncate"
                        style={font}
                      >
                        {t("import.popular_on_soundcloud_sub")}
                      </span>
                    )}
                  </div>
                  {trendingTracks.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0 !h-[28px] !px-[10px] !text-[12px]"
                      disabled={importing}
                      onClick={() => void handleSeedsImport(trendingTracks)}
                    >
                      {t("import.add_all_tracks")}
                    </Button>
                  )}
                </div>

                {trendingLoading ? (
                  <span className="text-[12px] text-text-tertiary" style={font}>
                    {t("common.loading")}
                  </span>
                ) : trendingError ? (
                  <div className="flex items-center justify-between gap-[8px]">
                    <span className="text-[12px] text-text-tertiary" style={font}>
                      {t("import.soundcloud_trending_failed")}
                    </span>
                    <button
                      type="button"
                      onClick={() => void loadTrending()}
                      className="shrink-0 bg-transparent border-none p-0 text-[12px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                      style={font}
                    >
                      {t("import.try_again")}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col max-h-[168px] overflow-y-auto gap-[2px]">
                    {trendingTracks.map((track, i) => (
                      <button
                        key={track.sourceId}
                        type="button"
                        title={track.title}
                        disabled={importing}
                        onClick={() => void handleSeedsImport([track])}
                        className="flex items-center gap-[8px] w-full rounded-md border-none bg-transparent px-[6px] py-[5px] text-left text-text-secondary hover:text-text-primary hover:bg-border-alpha-14 transition-colors cursor-pointer disabled:opacity-60"
                      >
                        <span
                          className="shrink-0 w-[16px] text-right text-[11px] text-text-tertiary tabular-nums"
                          style={font}
                        >
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex flex-col">
                          <span
                            className="text-[12px] font-[500] truncate text-text-primary"
                            style={font}
                          >
                            {track.title}
                          </span>
                          <span
                            className="text-[11px] text-text-tertiary truncate"
                            style={font}
                          >
                            {track.artists.join(", ")}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-[8px] mt-[2px]">
              <Button type="button" variant="ghost" size="sm" onClick={close}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={importing}>
                {importing ? t("common.importing") : t("common.import")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  );
}
