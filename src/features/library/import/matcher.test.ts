import { describe, it, expect } from "vitest";
import { matchSeedsToCatalog, scoreCandidate, type SearchTracksFn } from "./matcher";
import type { SourceTrackSeed } from "./parsers";
import type { ApiTrack, SearchResponse } from "@/shared/api";

const track = (overrides: Partial<ApiTrack>): ApiTrack =>
  ({
    id: "id",
    title: "Song",
    artists: [{ id: "a1", name: "Artist" }],
    durationMs: 200000,
    type: "track",
    ...overrides,
  } as ApiTrack);

function searchReturns(items: ApiTrack[]): SearchTracksFn {
  return async () => ({ items: items as unknown as SearchResponse["items"] });
}

describe("scoreCandidate", () => {
  const seed: SourceTrackSeed = {
    sourceId: "yt:1",
    title: "Song Title",
    artists: ["Artist Name"],
    durationMs: 200000,
  };

  it("scores exact matches highest", () => {
    const exact = scoreCandidate(seed, { title: "Song Title", artists: ["Artist Name"], durationMs: 200000 });
    const unrelated = scoreCandidate(seed, { title: "Something Else", artists: ["Nobody"], durationMs: 300000 });
    expect(exact).toBeGreaterThan(0.72);
    expect(unrelated).toBeLessThan(0.4);
  });

  it("penalizes large duration mismatch", () => {
    const near = scoreCandidate(seed, { title: "Song Title", artists: ["Artist Name"], durationMs: 600000 });
    const close = scoreCandidate(seed, { title: "Song Title", artists: ["Artist Name"], durationMs: 210000 });
    expect(near).toBeLessThan(close);
  });
});

describe("matchSeedsToCatalog", () => {
  it("maps exact matches to auto_matched reviews", async () => {
    const seeds: SourceTrackSeed[] = [
      { sourceId: "yt:v1", title: "Perfect Match", artists: ["Big Artist"], durationMs: 210000 },
    ];
    const searchFn = searchReturns([
      track({ id: "catalog-1", title: "Perfect Match", artists: [{ id: "a", name: "Big Artist" }], durationMs: 205000 }),
    ]);
    const reviews = await matchSeedsToCatalog(seeds, searchFn);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].reason).toBe("auto_matched");
    expect(reviews[0].proposedTrack?.id).toBe("catalog-1");
    expect(reviews[0].sourceTrack.sourceId).toBe("yt:v1");
    expect(reviews[0].status).toBe("pending");
  });

  it("marks no results as no_catalog_candidates", async () => {
    const seeds: SourceTrackSeed[] = [{ sourceId: "yt:v1", title: "Nothing", artists: ["Nobody"] }];
    const reviews = await matchSeedsToCatalog(seeds, searchReturns([]));
    expect(reviews[0].reason).toBe("no_catalog_candidates");
    expect(reviews[0].proposedTrack).toBeUndefined();
  });

  it("falls back to low_confidence for approximate matches", async () => {
    const seeds: SourceTrackSeed[] = [
      { sourceId: "yt:v1", title: "Song of Life", artists: ["Artist A"] },
    ];
    const searchFn = searchReturns([
      track({ id: "catalog-2", title: "Song of My Life", artists: [{ id: "a", name: "Somebody Else" }], durationMs: 250000 }),
    ]);
    const reviews = await matchSeedsToCatalog(seeds, searchFn);
    expect(reviews[0].reason).toBe("low_confidence_match");
    expect(reviews[0].proposedTrack).toBeDefined();
  });

  it("reports lookup failures", async () => {
    const seeds: SourceTrackSeed[] = [{ sourceId: "yt:v1", title: "Boom", artists: ["Fail"] }];
    const searchFn: SearchTracksFn = async () => {
      throw new Error("network");
    };
    const reviews = await matchSeedsToCatalog(seeds, searchFn);
    expect(reviews[0].reason).toBe("catalog_lookup_failed");
    expect(reviews[0].proposedTrack).toBeUndefined();
  });
});