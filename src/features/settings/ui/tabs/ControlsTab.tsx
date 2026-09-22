import { useState, useEffect } from "react";
import { useTranslation } from "@/languages";
import { ToggleSwitch, useToast } from "@/shared/ui";
import {
  DEFAULT_BINDINGS,
  findConflictingShortcut,
  parseOrLabel,
  RESERVED_CODES,
  serializeCombo,
  SHORTCUT_IDS,
  useShortcutsStore,
  type ShortcutId,
} from "../../store/shortcutsStore";
import { useDiscordRpcStore, type DiscordAssetKey } from "../../store/discordStore";
import { SettingRow, SettingSection, SegmentedControl } from "../controls";

const font = { fontFamily: "var(--font-inter), sans-serif" } as const;

const SHORTCUT_LABEL_KEYS: Record<ShortcutId, string> = {
  togglePlayPause: "settings.about.shortcut_play",
  skipNext: "settings.about.shortcut_next",
  skipPrevious: "settings.about.shortcut_prev",
  search: "settings.about.shortcut_search",
  lyrics: "settings.about.shortcut_lyrics",
  miniPlayer: "settings.about.shortcut_mini",
};

const SHORTCUT_DESC_KEYS: Record<ShortcutId, string> = {
  togglePlayPause: "settings.controls.shortcut_play_desc",
  skipNext: "settings.controls.shortcut_next_desc",
  skipPrevious: "settings.controls.shortcut_prev_desc",
  search: "settings.controls.shortcut_search_desc",
  lyrics: "settings.controls.shortcut_lyrics_desc",
  miniPlayer: "settings.controls.shortcut_mini_desc",
};

function ShortcutRow({ id, searchQuery }: { id: ShortcutId; searchQuery?: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const bindings = useShortcutsStore((state) => state.bindings);
  const setBinding = useShortcutsStore((state) => state.setBinding);
  const resetBinding = useShortcutsStore((state) => state.resetBinding);

  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (
        e.key === "Escape" &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        !e.metaKey
      ) {
        setRecording(false);
        setError(null);
        return;
      }
      const code = e.code;
      if (
        code.startsWith("Control") ||
        code.startsWith("Shift") ||
        code.startsWith("Alt") ||
        code.startsWith("Meta")
      ) {
        return;
      }
      if (RESERVED_CODES.has(code)) {
        setError(t("settings.controls.reserved"));
        return;
      }
      const combo = serializeCombo(code, {
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        alt: e.altKey,
        shift: e.shiftKey,
      });
      const conflict = findConflictingShortcut(bindings, combo, id);
      if (conflict) {
        if (DEFAULT_BINDINGS[conflict] === combo) {
          setError(
            t("settings.controls.conflict", { label: t(SHORTCUT_LABEL_KEYS[conflict]) }),
          );
          return;
        }
        setBinding(id, combo);
        resetBinding(conflict);
        setRecording(false);
        setError(null);
        toast(
          t("settings.controls.taken", { label: t(SHORTCUT_LABEL_KEYS[conflict]) }),
          "info",
        );
        return;
      }
      setBinding(id, combo);
      setRecording(false);
      setError(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, id, bindings, setBinding, resetBinding, toast, t]);

  const description = recording
    ? `${t("settings.controls.recording")}…`
    : (error ?? t(SHORTCUT_DESC_KEYS[id]));

  return (
    <SettingRow
      title={t(SHORTCUT_LABEL_KEYS[id])}
      description={description}
      titleKey={SHORTCUT_LABEL_KEYS[id]}
      descKey={SHORTCUT_DESC_KEYS[id]}
      searchQuery={searchQuery}
      control={
        <div className="flex items-center gap-[8px]">
          {recording ? (
            <button
              type="button"
              onClick={() => {
                setRecording(false);
                setError(null);
              }}
              className="h-[28px] cursor-pointer rounded-[8px] border-[1px] border-solid border-border-primary bg-border-alpha-14 px-[10px] text-[12.5px] font-[500] text-text-primary transition-colors hover:bg-border-alpha-20"
              style={font}
            >
              {t("settings.controls.recording")}…
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setRecording(true);
                setError(null);
              }}
              aria-label={t("settings.controls.recording")}
              className={`inline-flex h-[28px] cursor-pointer items-center rounded-[8px] border-[1px] border-solid px-[10px] text-[12.5px] font-[500] tabular-nums transition-colors ${
                error
                  ? "border-red-500/40 text-text-primary"
                  : "border-border-primary bg-border-alpha-14 text-text-primary hover:bg-border-alpha-20"
              }`}
              style={font}
            >
              {parseOrLabel(bindings[id])}
            </button>
          )}
          <button
            type="button"
            onClick={() => resetBinding(id)}
            disabled={bindings[id] === DEFAULT_BINDINGS[id]}
            title={t("settings.controls.reset")}
            className="h-[28px] cursor-pointer rounded-[8px] border-0 bg-transparent px-[8px] text-[12px] text-text-tertiary transition-colors hover:text-text-primary disabled:cursor-default disabled:opacity-40"
            style={font}
          >
            {t("settings.controls.reset")}
          </button>
        </div>
      }
    />
  );
}

export function ControlsTab({ searchQuery }: { searchQuery?: string }) {
  const { t } = useTranslation();
  const [mounted, setMounted] = useState(false);
  const resetAll = useShortcutsStore((state) => state.resetAll);

  const enabled = useDiscordRpcStore((state) => state.enabled);
  const setEnabled = useDiscordRpcStore((state) => state.setEnabled);
  const largeImage = useDiscordRpcStore((state) => state.largeImage);
  const setLargeImage = useDiscordRpcStore((state) => state.setLargeImage);
  const smallImage = useDiscordRpcStore((state) => state.smallImage);
  const setSmallImage = useDiscordRpcStore((state) => state.setSmallImage);

  useEffect(() => {
    setMounted(true);
  }, []);

  const assetOptions = [
    { value: "logo" as DiscordAssetKey, label: t("settings.controls.asset_logo") },
    { value: "cover" as DiscordAssetKey, label: t("settings.controls.asset_cover") },
  ];

  return (
    <div className="flex w-full flex-col gap-[16px] pt-[4px]">
      <SettingSection label={t("settings.controls.shortcuts_section")}>
        {SHORTCUT_IDS.map((id) => (
          <ShortcutRow key={id} id={id} searchQuery={searchQuery} />
        ))}
        <div className="flex items-center justify-between gap-[16px] py-[13px]">
          <p className="m-0 max-w-[360px] text-[12px] leading-relaxed text-text-tertiary" style={font}>
            {t("settings.controls.reserved_hint")}
          </p>
          <button
            type="button"
            onClick={resetAll}
            className="shrink-0 cursor-pointer rounded-[8px] border-0 bg-transparent px-[10px] py-[6px] text-[12px] text-text-tertiary transition-colors hover:text-text-primary"
            style={font}
          >
            {t("settings.controls.reset_all")}
          </button>
        </div>
      </SettingSection>

      <SettingSection label={t("settings.controls.discord_section")}>
        <SettingRow
          title={t("settings.controls.discord_enabled")}
          description={t("settings.controls.discord_enabled_desc")}
          titleKey="settings.controls.discord_enabled"
          descKey="settings.controls.discord_enabled_desc"
          searchQuery={searchQuery}
          control={<ToggleSwitch checked={enabled} onChange={setEnabled} />}
        />
        <SettingRow
          title={t("settings.controls.discord_large")}
          description={t("settings.controls.discord_large_desc")}
          titleKey="settings.controls.discord_large"
          descKey="settings.controls.discord_large_desc"
          searchQuery={searchQuery}
          control={
            mounted ? (
              <SegmentedControl
                ariaLabel={t("settings.controls.discord_large")}
                value={largeImage}
                onChange={setLargeImage}
                options={assetOptions}
              />
            ) : (
              <span />
            )
          }
        />
        <SettingRow
          title={t("settings.controls.discord_small")}
          description={t("settings.controls.discord_small_desc")}
          titleKey="settings.controls.discord_small"
          descKey="settings.controls.discord_small_desc"
          searchQuery={searchQuery}
          control={
            mounted ? (
              <SegmentedControl
                ariaLabel={t("settings.controls.discord_small")}
                value={smallImage}
                onChange={setSmallImage}
                options={assetOptions}
              />
            ) : (
              <span />
            )
          }
        />
      </SettingSection>
    </div>
  );
}