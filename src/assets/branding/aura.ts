import type { AccentVariant } from "@/features/player";

// Aura = soft glow cast behind the logo on the sidebar / about / login.
// The logo itself always uses the "default" artwork; the chosen variant
// now only drives the color of this glow.
export const AURA_COLORS: Record<AccentVariant, string> = {
  default: "#a78bfa",
  spotify: "#22c55e",
  discord: "#7c8bff",
  telegram: "#4ab8e8",
  aurora: "#4be3d5",
  sunset: "#fb8bc0",
  ocean: "#5fc9fd",
  forest: "#6ee7a0",
  berry: "#fb5c7e",
  carbon: "#d4d4d4",
  pixel: "#4ade80",
  scanlines: "#63d2ff",
  vhs: "#fd9249",
};

export function getAuraColor(variant: string): string {
  return AURA_COLORS[variant as AccentVariant] ?? AURA_COLORS.default;
}

// Strengthened aura: brighter, wider glow for canvas icon rendering and
// boxShadow layers. Returns a color already carrying higher alpha so the
// aura is clearly visible on dark surfaces.
export function getAuraGlowColor(variant: string): string {
  const base = getAuraColor(variant);
  const isDark = variant === "carbon" || variant === "default";
  return isDark ? `${base}cc` : `${base}ff`;
}