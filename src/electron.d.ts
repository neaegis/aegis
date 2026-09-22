import type { AegisElectronApi } from "../electron/preload";

declare global {
  interface Window {
    aegisElectron?: AegisElectronApi;
  }
}

export {};
