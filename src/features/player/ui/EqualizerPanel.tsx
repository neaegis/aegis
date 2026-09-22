import { memo, useCallback, useRef } from "react";
import { playerEngine, usePlayerStore } from "@/features/player";
import {
  EQ_BAND_FREQUENCIES,
  EQ_PRESETS,
  EQ_PRESET_IDS,
  EQ_FLAT_BANDS,
  EQ_MIN_DB,
  EQ_MAX_DB,
  type EqPresetId,
} from "../engine/equalizer";
import { useTranslation } from "@/languages";

function formatFrequency(frequency: number): string {
  if (frequency >= 1000) {
    const k = frequency / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return String(frequency);
}

function eqLabelFor(preset: EqPresetId): string {
  return `eq.presets.${preset}`;
}

interface EqBandSliderProps {
  index: number;
  value: number;
  onDragBands: (next: number[]) => void;
}

const EqBandSlider = memo(function EqBandSlider({
  index,
  value,
  onDragBands,
}: EqBandSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const commitValue = useCallback(
    (targetIndex: number, nextValue: number) => {
      const base = currentBandsRef.current;
      const next = [...base];
      next[targetIndex] = Math.min(
        EQ_MAX_DB,
        Math.max(EQ_MIN_DB, nextValue),
      );
      onDragBands(next);
    },
    [onDragBands],
  );

  const applyFromClientY = useCallback(
    (clientY: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.height === 0) return;
      const ratio = Math.min(
        1,
        Math.max(0, (rect.bottom - clientY) / rect.height),
      );
      const db = Math.round(EQ_MIN_DB + ratio * (EQ_MAX_DB - EQ_MIN_DB));
      commitValue(index, db);
    },
    [commitValue, index],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.target as HTMLElement;
      target.setPointerCapture?.(event.pointerId);
      applyFromClientY(event.clientY);

      const onMove = (ev: PointerEvent) => {
        applyFromClientY(ev.clientY);
      };
      const onUp = (ev: PointerEvent) => {
        try {
          target.releasePointerCapture?.(ev.pointerId);
        } catch {}
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [applyFromClientY],
  );

  const half = 59;
  const magnitude = Math.min(1, Math.abs(value) / EQ_MAX_DB);
  const fillHeight = magnitude * half;
  const fillTop = value >= 0 ? half - fillHeight : half;

  return (
    <div className="flex flex-col items-center gap-[6px]">
      <span
        className={`min-h-[14px] text-[10px] font-[500] tabular-nums ${
          value === 0 ? "text-text-tertiary/60" : "text-text-secondary"
        }`}
      >
        {value > 0 ? `+${value}` : value}
      </span>
      <div
        ref={trackRef}
        role="slider"
        aria-label={`Band ${index + 1}`}
        aria-valuemin={EQ_MIN_DB}
        aria-valuemax={EQ_MAX_DB}
        aria-valuenow={value}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            commitValue(index, value + 1);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            commitValue(index, value - 1);
          }
        }}
        className="relative h-[118px] w-[22px] cursor-pointer touch-none select-none outline-none"
      >
        <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-black/[0.10] dark:bg-white/[0.14]" />
        {value !== 0 && (
          <div
            className="absolute left-1/2 w-[4px] -translate-x-1/2 rounded-full bg-text-primary/80"
            style={{ top: `${fillTop}px`, height: `${Math.max(2, fillHeight)}px` }}
          />
        )}
        <div
          className="absolute left-1/2 h-[10px] w-[12px] -translate-x-1/2 rounded-[3px] bg-text-primary shadow-md"
          style={{ top: `${half - 5 + (value > 0 ? -fillHeight : fillHeight)}px` }}
        />
      </div>
      <span className="text-[10px] text-text-tertiary tabular-nums">
        {formatFrequency(EQ_BAND_FREQUENCIES[index])}
      </span>
    </div>
  );
});

const currentBandsRef: { current: number[] } = { current: EQ_FLAT_BANDS };

export const EqualizerPanel = memo(function EqualizerPanel() {
  const { t } = useTranslation();
  const preset = usePlayerStore((state) => state.eqPreset);
  const customBands = usePlayerStore((state) => state.eqCustomBands);

  const bands =
    preset === "custom"
      ? customBands
      : (EQ_PRESETS[preset as Exclude<EqPresetId, "custom">] ?? EQ_FLAT_BANDS);
  currentBandsRef.current = bands;

  const handlePickPreset = useCallback((id: Exclude<EqPresetId, "custom">) => {
    playerEngine.setEqPreset(id);
  }, []);

  const handleDragBands = useCallback((next: number[]) => {
    playerEngine.setEqCustomBands(next);
  }, []);

  return (
    <div
      className="w-[min(560px,calc(100vw-88px))] rounded-xl bg-bg-primary border border-border-primary/50 px-[14px] py-[12px] flex flex-col gap-[10px] shadow-xl"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-[8px]">
          <span
            className="text-[13.5px] font-medium text-text-primary"
            style={{ fontFamily: "var(--font-inter), sans-serif" }}
          >
            {t("eq.title")}
          </span>
          <span className="rounded-[5px] bg-btn-primary-bg px-[6px] py-[2px] text-[9px] font-bold uppercase tracking-wider text-btn-primary-text">
            {t("eq.beta")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => playerEngine.resetEq()}
          className="border-none bg-transparent p-0 text-[12px] text-text-tertiary transition-colors hover:text-text-primary cursor-pointer"
        >
          {t("eq.reset")}
        </button>
      </div>

      <div className="flex flex-wrap gap-[6px]">
        {preset === "custom" && (
          <span
            className="rounded-full bg-border-alpha-14 px-[12px] py-[5px] text-[12.5px] font-medium text-text-primary"
            style={{ fontFamily: "var(--font-inter), sans-serif" }}
          >
            {t("eq.presets.custom")}
          </span>
        )}
        {EQ_PRESET_IDS.map((id) => {
          const active = preset === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handlePickPreset(id)}
              className={`
                relative flex items-center gap-[7px] px-[12px] py-[5px] rounded-full text-[12.5px] transition-colors border-none bg-transparent cursor-pointer select-none
                ${
                  active
                    ? "text-text-primary font-medium"
                    : "text-text-secondary hover:text-text-primary hover:bg-border-alpha-14"
                }
              `}
              style={{ fontFamily: "var(--font-inter), sans-serif" }}
            >
              {active && (
                <span className="absolute inset-0 rounded-full bg-border-alpha-14 pointer-events-none z-0" />
              )}
              <span className="relative z-[1]">{t(eqLabelFor(id))}</span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-10 items-end gap-[8px]">
        {EQ_BAND_FREQUENCIES.map((_, index) => (
          <EqBandSlider
            key={EQ_BAND_FREQUENCIES[index]}
            index={index}
            value={bands[index] ?? 0}
            onDragBands={handleDragBands}
          />
        ))}
      </div>

      <p
        className="m-0 text-[11px] text-text-tertiary"
        style={{ fontFamily: "var(--font-inter), sans-serif" }}
      >
        {t("eq.hint")}
      </p>
    </div>
  );
});

export default EqualizerPanel;