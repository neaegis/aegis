import aegisLogo from "./aegis.png";

// Single brand logo — the new aegis artwork. It is used everywhere
// (sidebar, about, login, window/tray icon) as-is: no variant-specific
// silhouettes, no white flat recolor for dark mode, no filters.
const brandingLogos: Record<string, string> = {
  default: aegisLogo,
  spotify: aegisLogo,
  discord: aegisLogo,
  telegram: aegisLogo,
  aurora: aegisLogo,
  sunset: aegisLogo,
  ocean: aegisLogo,
  forest: aegisLogo,
  berry: aegisLogo,
  carbon: aegisLogo,
  pixel: aegisLogo,
  scanlines: aegisLogo,
  vhs: aegisLogo,
};

export default brandingLogos;

export function getBrandLogo(_variant: string, _isDark: boolean): string {
  return brandingLogos.default;
}

export * from "./aura";
