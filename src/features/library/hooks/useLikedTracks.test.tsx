// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createRoot, Root } from "react-dom/client";
import { act } from "react";
import { useLikedTracks, applyOptimisticLike } from "./useLikedTracks";
import { aegisDb } from "@/shared/storage/aegisDb";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const GUEST_USER_ID = "guest";

async function seedLike(id: string, title: string, artists: string) {
  await aegisDb.putLike(GUEST_USER_ID, {
    id,
    title,
    artists,
    coverUrl: "",
    durationMs: 0,
    playCount: 0,
  });
}

describe("useLikedTracks", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(async () => {
    await aegisDb.clearStore("likes");
    await seedLike("track-1", "Song 1", "Artist 1");
  });

  afterAll(async () => {
    await aegisDb.clearStore("likes");
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    document.body.removeChild(container);
  });

  it("loads likes from local db and keeps isLoading false during background refresh", async () => {
    let hookResult: ReturnType<typeof useLikedTracks> | undefined;

    function TestComponent() {
      hookResult = useLikedTracks();
      return <div>loaded: {(!hookResult.isLoading).toString()}</div>;
    }

    await act(async () => {
      root.render(<TestComponent />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(hookResult?.isLoading).toBe(false);
    expect(hookResult?.data.tracks).toHaveLength(1);
    expect(hookResult?.data.tracks[0]?.title).toBe("Song 1");

    // Apply optimistic like
    act(() => {
      applyOptimisticLike("track-2");
    });
    expect(hookResult?.data.tracks).toHaveLength(2);
    expect(hookResult?.isLoading).toBe(false);

    // Background refresh before track-2 is persisted must not touch loading state
    await act(async () => {
      window.dispatchEvent(new Event("library:changed"));
    });

    expect(hookResult?.isLoading).toBe(false);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // optimistic override was cleared; track-2 not yet in db
    expect(hookResult?.data.tracks).toHaveLength(1);

    // Persist track-2 and refresh again
    await act(async () => {
      await seedLike("track-2", "Song 2", "Artist 2");
      window.dispatchEvent(new Event("library:changed"));
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(hookResult?.isLoading).toBe(false);
    expect(hookResult?.data.tracks).toHaveLength(2);
    expect(hookResult?.data.tracks[0]?.title).toBe("Song 2");
  });
});