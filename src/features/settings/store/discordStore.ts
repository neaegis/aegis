import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  registerUserScopedRehydrate,
  userScopedStorage,
} from "@/shared/utils/userScope";

export type DiscordAssetKey = "logo" | "cover";

export interface DiscordRpcState {
  enabled: boolean;
  largeImage: DiscordAssetKey;
  smallImage: DiscordAssetKey;
  setEnabled: (value: boolean) => void;
  setLargeImage: (value: DiscordAssetKey) => void;
  setSmallImage: (value: DiscordAssetKey) => void;
}

export const DISCORD_ASSET_KEY_TO_ASSET: Record<DiscordAssetKey, string> = {
  logo: "aegis_logo",
  cover: "aegis_cover",
};

export const useDiscordRpcStore = create<DiscordRpcState>()(
  persist(
    (set) => ({
      enabled: true,
      largeImage: "cover",
      smallImage: "logo",
      setEnabled: (enabled) => set({ enabled }),
      setLargeImage: (largeImage) => set({ largeImage }),
      setSmallImage: (smallImage) => set({ smallImage }),
    }),
    {
      name: "aegis_discord_rpc_v1",
      storage: createJSONStorage(() => userScopedStorage),
      partialize: (state) => ({
        enabled: state.enabled,
        largeImage: state.largeImage,
        smallImage: state.smallImage,
      }),
    },
  ),
);

registerUserScopedRehydrate(() => useDiscordRpcStore.persist.rehydrate());