import { describe, it, expect } from "vitest";
import {
  isTrackStub,
  normalizeSoundCloudTrack,
  parseSoundCloudClientId,
  soundCloudArtworkUrl,
} from "./soundcloud";

describe("parseSoundCloudClientId", () => {
  it("extracts client_id from a webpack chunk", () => {
    const js = `window.__webpack_require__.u=function(e){return e+"-"+{44:"abc"}[e]+".js"};var client_id:"Pb72ranhoyt6gw7hM7TkzUItXlMWSNSo";`;
    expect(parseSoundCloudClientId(js)).toBe("Pb72ranhoyt6gw7hM7TkzUItXlMWSNSo");
  });

  it("supports equals form", () => {
    expect(parseSoundCloudClientId("x=1;client_id = 'A1b2C3d4E5f6G7h8I9j0'")).toBe(
      "A1b2C3d4E5f6G7h8I9j0",
    );
  });

  it("returns undefined when absent", () => {
    expect(parseSoundCloudClientId("no client here")).toBeUndefined();
  });
});

describe("normalizeSoundCloudTrack", () => {
  it("maps a full track object to a seed dto", () => {
    const dto = normalizeSoundCloudTrack({
      id: 123,
      title: "  Goose Coat  ",
      duration: 170322,
      artwork_url: "https://i1.sndcdn.com/artworks-u1gp4QgUsrA1-0-large.jpg",
      permalink_url: "https://soundcloud.com/user/surf7-goose-coat",
      user: { username: "Surf7" },
    });
    expect(dto).toEqual({
      sourceId: "sc:123",
      title: "Goose Coat",
      artists: ["Surf7"],
      durationMs: 170322,
      coverUrl: "https://i1.sndcdn.com/artworks-u1gp4QgUsrA1-0-t500x500.jpg",
      permalinkUrl: "https://soundcloud.com/user/surf7-goose-coat",
    });
  });

  it("unwraps a chart { track } wrapper", () => {
    const dto = normalizeSoundCloudTrack({
      track: {
        id: 9,
        title: "Chart Entry",
        duration: 60000,
        user: { username: "Artist" },
      },
    });
    expect(dto?.sourceId).toBe("sc:9");
    expect(dto?.title).toBe("Chart Entry");
    expect(dto?.artists).toEqual(["Artist"]);
  });

  it("falls back to user avatar when artwork is missing", () => {
    const dto = normalizeSoundCloudTrack({
      id: 1,
      title: "No Artwork",
      duration: 30000,
      user: { username: "X", avatar_url: "https://i1.sndcdn.com/avatars-a1-0-large.jpg" },
    });
    expect(dto?.coverUrl).toBe("https://i1.sndcdn.com/avatars-a1-0-t500x500.jpg");
  });

  it("returns null without id or title", () => {
    expect(normalizeSoundCloudTrack({ id: 0, title: "" })).toBeNull();
    expect(normalizeSoundCloudTrack(null)).toBeNull();
    expect(normalizeSoundCloudTrack({ title: "no id" })).toBeNull();
  });

  it("provides a SoundCloud fallback artist", () => {
    const dto = normalizeSoundCloudTrack({ id: 2, title: "Orphan", duration: 10000 });
    expect(dto?.artists).toEqual(["SoundCloud"]);
  });
});

describe("soundCloudArtworkUrl", () => {
  it("replaces -large with t500x500", () => {
    expect(soundCloudArtworkUrl("https://x/art-a-large.jpg")).toBe(
      "https://x/art-a-t500x500.jpg",
    );
  });
  it("leaves null/undefined/intact", () => {
    expect(soundCloudArtworkUrl(null)).toBeUndefined();
    expect(soundCloudArtworkUrl(undefined)).toBeUndefined();
  });
});

describe("isTrackStub", () => {
  it("detects a compact stub from large playlists", () => {
    expect(isTrackStub({ id: 2114758488, kind: "track", monetization_model: "NOT_APPLICABLE", policy: "ALLOW" })).toBe(true);
  });

  it("detects a stub wrapped in { track }", () => {
    expect(isTrackStub({ track: { id: 42, kind: "track", monetization_model: "NOT_APPLICABLE" } })).toBe(true);
  });

  it("rejects a full track with title", () => {
    expect(isTrackStub({ id: 5, title: "Full track", user: { username: "X" } })).toBe(false);
  });

  it("rejects wrapped full tracks", () => {
    expect(isTrackStub({ track: { id: 7, title: "Wrapped", user: { username: "Y" } } })).toBe(false);
  });

  it("rejects empty/destroyed objects", () => {
    expect(isTrackStub(null)).toBe(false);
    expect(isTrackStub(undefined)).toBe(false);
    expect(isTrackStub("nope")).toBe(false);
    expect(isTrackStub({})).toBe(false);
  });
});