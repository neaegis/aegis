import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  registerUserScopedRehydrate,
  userScopedStorage,
} from "@/shared/utils/userScope";

export type ShortcutId =
  | "togglePlayPause"
  | "skipNext"
  | "skipPrevious"
  | "search"
  | "lyrics"
  | "miniPlayer";

export const SHORTCUT_IDS: ShortcutId[] = [
  "togglePlayPause",
  "skipNext",
  "skipPrevious",
  "search",
  "lyrics",
  "miniPlayer",
];

export const DEFAULT_BINDINGS: Record<ShortcutId, string> = {
  togglePlayPause: "Space",
  skipNext: "MediaTrackNext",
  skipPrevious: "MediaTrackPrevious",
  search: "Slash",
  lyrics: "KeyL",
  miniPlayer: "KeyP",
};

export const RESERVED_CODES = new Set<string>([
  "Escape",
  "KeyF",
  "KeyQ",
  "KeyM",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
]);

const MODIFIER_PREFIXES: { field: "ctrl" | "alt" | "shift" | "meta"; prefix: string }[] = [
  { field: "ctrl", prefix: "Ctrl" },
  { field: "alt", prefix: "Alt" },
  { field: "shift", prefix: "Shift" },
  { field: "meta", prefix: "Meta" },
];

export type ComboModifiers = Partial<Record<"ctrl" | "alt" | "shift" | "meta", boolean>>;

export interface ParsedCombo {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export interface ShortcutState {
  bindings: Record<ShortcutId, string>;
  setBinding: (id: ShortcutId, combo: string) => void;
  resetBinding: (id: ShortcutId) => void;
  resetAll: () => void;
}

export function serializeCombo(key: string, mods: ComboModifiers = {}): string {
  const parts: string[] = [];
  for (const { field, prefix } of MODIFIER_PREFIXES) {
    if (mods[field]) parts.push(prefix);
  }
  parts.push(key);
  return parts.join("+");
}

export function parseCombo(combo: string): ParsedCombo {
  const parts = combo
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts.pop() ?? "";
  return {
    key,
    ctrl: parts.includes("Ctrl"),
    alt: parts.includes("Alt"),
    shift: parts.includes("Shift"),
    meta: parts.includes("Meta"),
  };
}

export function matchesCombo(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  combo: string,
): boolean {
  const parsed = parseCombo(combo);
  return (
    event.code === parsed.key &&
    event.ctrlKey === parsed.ctrl &&
    event.metaKey === parsed.meta &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift
  );
}

const KEY_LABELS: Record<string, string> = {
  Space: "Space",
  Slash: "/",
  Backslash: "\\",
  Comma: ",",
  Period: ".",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Enter: "Enter",
  Tab: "Tab",
  Backspace: "⌫",
  Delete: "Del",
  Home: "Home",
  End: "End",
  PageUp: "PgUp",
  PageDown: "PgDn",
  MediaTrackNext: "⏭",
  MediaTrackPrevious: "⏮",
  MediaPlayPause: "⏯",
  MediaStop: "⏹",
};

export function keyToLabel(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  if (key.startsWith("Key") && key.length === 4) return key.slice(3);
  if (key.startsWith("Digit") && key.length === 6) return key.slice(5);
  if (key.startsWith("F") && /^F\d{1,2}$/.test(key)) return key;
  if (key.startsWith("Arrow")) {
    const arrowLabels: Record<string, string> = {
      ArrowLeft: "←",
      ArrowRight: "→",
      ArrowUp: "↑",
      ArrowDown: "↓",
    };
    return arrowLabels[key] ?? key.slice(5);
  }
  if (key.startsWith("Numpad")) return `Num ${key.slice(6)}`;
  return key;
}

export function parseOrLabel(combo: string): string {
  const parts = combo
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts
    .map((part) =>
      ["Ctrl", "Alt", "Shift", "Meta"].includes(part) ? part : keyToLabel(part),
    )
    .join(" + ");
}

export function comboFromKeyboardEvent(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): string {
  return serializeCombo(event.code, {
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
  });
}

export function findConflictingShortcut(
  bindings: Record<ShortcutId, string>,
  combo: string,
  excludeId: ShortcutId,
): ShortcutId | null {
  for (const id of SHORTCUT_IDS) {
    if (id !== excludeId && bindings[id] === combo) return id;
  }
  return null;
}

export const useShortcutsStore = create<ShortcutState>()(
  persist(
    (set) => ({
      bindings: { ...DEFAULT_BINDINGS },
      setBinding: (id, combo) =>
        set((state) => ({
          bindings: {
            ...state.bindings,
            [id]: combo,
          },
        })),
      resetBinding: (id) =>
        set((state) => ({
          bindings: {
            ...state.bindings,
            [id]: DEFAULT_BINDINGS[id],
          },
        })),
      resetAll: () => set({ bindings: { ...DEFAULT_BINDINGS } }),
    }),
    {
      name: "aegis_shortcuts_v1",
      storage: createJSONStorage(() => userScopedStorage),
      partialize: (state) => ({ bindings: state.bindings }),
    },
  ),
);

registerUserScopedRehydrate(() => useShortcutsStore.persist.rehydrate());