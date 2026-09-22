import { useEffect } from "react";
import { useTheme } from "next-themes";
import { usePlayerStore } from "../store/playerStore";
import { getBrandLogo } from "@/assets/branding";
import { getAuraColor } from "@/assets/branding/aura";

async function renderIconDataUrl(
  logoSrc: string,
  isLight: boolean,
  auraColor: string,
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(0, 0, 512, 512, 112);
  } else {
    ctx.rect(0, 0, 512, 512);
  }
  ctx.fillStyle = isLight ? "#f5f5f7" : "#0d0d10";
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = isLight ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.08)";
  ctx.stroke();

  // Aura = soft glow cast behind the logo on the icon canvas.
  const gradient = ctx.createRadialGradient(256, 256, 48, 256, 256, 236);
  gradient.addColorStop(0, `${auraColor}cc`);
  gradient.addColorStop(0.35, `${auraColor}77`);
  gradient.addColorStop(1, `${auraColor}00`);
  ctx.fillStyle = gradient;
  ctx.fillRect(32, 32, 448, 448);

  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load branding logo for icon"));
    img.src = logoSrc;
  });

  ctx.drawImage(img, 96, 96, 320, 320);
  return canvas.toDataURL("image/png");
}

export function useAppIconSync() {
  const accentVariant = usePlayerStore((state) => state.accentVariant);
  const { theme, resolvedTheme } = useTheme();

  useEffect(() => {
    const isLight = (resolvedTheme || theme) === "light";
    const logoSrc = getBrandLogo("default", !isLight);
    const auraColor = getAuraColor(accentVariant);
    let active = true;

    void renderIconDataUrl(logoSrc, isLight, auraColor).then((dataUrl) => {
      if (!active || !dataUrl) return;

      if (window.aegisElectron?.setAppIcon) {
        window.aegisElectron.setAppIcon(dataUrl);
      }

      let favicon = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
      if (!favicon) {
        favicon = document.createElement("link");
        favicon.rel = "icon";
        document.head.appendChild(favicon);
      }
      favicon.href = dataUrl;
    });

    return () => {
      active = false;
    };
  }, [accentVariant, theme, resolvedTheme]);
}
