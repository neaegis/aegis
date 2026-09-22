import { describe, it, expect } from "vitest";
import {
  detectImportSource,
  LocalImportError,
  parsePageForKind,
  parseSoundCloudPage,
  parseSpotifyPage,
  parseYouTubePage,
} from "./parsers";

function wrapScript(marker: string, json: unknown): string {
  return `<!doctype html><html><head></head><body>
    <script>window.${marker} = ${JSON.stringify(json)};</script>
  </body></html>`;
}

describe("detectImportSource", () => {
  it("detects youtube variants", () => {
    expect(detectImportSource("https://www.youtube.com/playlist?list=abc")).toBe("youtube");
    expect(detectImportSource("music.youtube.com/playlist?list=abc")).toBe("youtube");
    expect(detectImportSource("https://youtu.be/AbCdEfG")).toBe("youtube");
  });

  it("detects soundcloud", () => {
    expect(detectImportSource("https://soundcloud.com/user/sets/mix")).toBe("soundcloud");
    expect(detectImportSource("soundcloud.com/artist/track")).toBe("soundcloud");
  });

  it("detects spotify and others", () => {
    expect(detectImportSource("https://open.spotify.com/playlist/abc")).toBe("spotify");
    expect(detectImportSource("https://vk.com/audios0")).toBe("vk");
    expect(detectImportSource("https://music.yandex.ru/users/x/playlists/1")).toBe("yandex");
  });

  it("returns unknown for garbage", () => {
    expect(detectImportSource("not a url at all")).toBe("unknown");
    expect(detectImportSource("https://example.com/list")).toBe("unknown");
  });
});

describe("parseYouTubePage", () => {
  it("extracts tracks from playlistVideoRenderer", () => {
    const data = {
      contents: {
        twoColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [
                      {
                        itemSectionRenderer: {
                          contents: [
                            {
                              playlistVideoListRenderer: {
                                contents: [
                                  {
                                    playlistVideoRenderer: {
                                      videoId: "v1",
                                      title: { runs: [{ text: "Song One" }] },
                                      longBylineText: { runs: [{ text: "Artist A, Artist B" }] },
                                      lengthText: { simpleText: "4:05" },
                                      thumbnail: {
                                        thumbnails: [{ url: "https://i.ytimg.com/vi/v1/hq.jpg" }],
                                      },
                                    },
                                  },
                                  {
                                    playlistVideoRenderer: {
                                      videoId: "v2",
                                      title: { runs: [{ text: "Song Two (Radio Edit)" }] },
                                      longBylineText: { runs: [{ text: "Artist C" }] },
                                      lengthText: { simpleText: "3:01" },
                                    },
                                  },
                                ],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
      metadata: {
        playlistMetadataRenderer: { title: "My Cool Mix" },
      },
    };

    const parsed = parseYouTubePage(wrapScript("ytInitialData", data), "https://www.youtube.com/playlist?list=x");
    expect(parsed.source).toBe("youtube");
    expect(parsed.title).toBe("My Cool Mix");
    expect(parsed.tracks).toHaveLength(2);
    expect(parsed.tracks[0]).toMatchObject({
      sourceId: "yt:v1",
      title: "Song One",
      artists: ["Artist A", "Artist B"],
      durationMs: 245000,
    });
    expect(parsed.tracks[1].durationMs).toBe(181000);
  });

  it("extracts tracks from musicPlaylistShelfRenderer (YT Music)", () => {
    const data = {
      contents: {
        singleColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [
                      {
                        musicPlaylistShelfRenderer: {
                          contents: [
                            {
                              musicResponsiveListItemRenderer: {
                                flexColumns: [
                                  { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: "Chill Song" }] } } },
                                  {
                                    musicResponsiveListItemFlexColumnRenderer: {
                                      text: {
                                        runs: [
                                          { text: "Singer X" },
                                          { text: " · " },
                                          { text: "2024" },
                                        ],
                                      },
                                    },
                                  },
                                ],
                                fixedColumns: [
                                  {
                                    musicResponsiveListItemFixedColumnRenderer: {
                                      text: { runs: [{ text: "3:45" }] },
                                    },
                                  },
                                ],
                                thumbnail: {
                                  musicThumbnailRenderer: {
                                    thumbnail: { thumbnails: [{ url: "https://yt3.example/thumb.jpg" }] },
                                  },
                                },
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    };

    const parsed = parseYouTubePage(wrapScript("ytInitialData", data), "https://music.youtube.com/playlist?list=x");
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0]).toMatchObject({
      title: "Chill Song",
      durationMs: 225000,
    });
    expect(parsed.tracks[0].artists.join(", ")).toBe("Singer X, 2024");
  });

  it("falls back to a single video via ytInitialPlayerResponse", () => {
    const data = {
      videoDetails: {
        videoId: "vX",
        title: "Standalone Track",
        author: "Some Author",
        lengthSeconds: "240",
        thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/vi/vX/default.jpg" }] },
      },
    };
    const html = wrapScript("ytInitialPlayerResponse", data);
    const parsed = parseYouTubePage(html, "https://youtu.be/vX");
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.tracks[0]).toMatchObject({
      sourceId: "yt:vX",
      title: "Standalone Track",
      artists: ["Some Author"],
      durationMs: 240000,
    });
  });

  it("throws no_tracks when nothing could be parsed", () => {
    expect(() => parseYouTubePage("<html>nothing here</html>", "https://youtube.com/playlist?list=x")).toThrow(LocalImportError);
  });
});

describe("parseSoundCloudPage", () => {
  it("extracts tracks from hydration data", () => {
    const hydration = [
      { hydratable: "user", data: { id: 1, username: "dj" } },
      {
        hydratable: "likes",
        data: {
          collection: [
            { id: 11, kind: "track", title: "Cloud Track", duration: 190000, user: { username: "artist-z" }, artwork_url: "https://i1.sndcdn.com/art-1-large.jpg" },
            { id: 12, kind: "track", title: "Second Cloud Track", duration: 200000, user: { username: "artist-y" } },
          ],
        },
      },
    ];
    const html = wrapScript("__sc_hydration", hydration);
    const parsed = parseSoundCloudPage(html);
    expect(parsed.source).toBe("soundcloud");
    expect(parsed.tracks).toHaveLength(2);
    expect(parsed.tracks[0]).toMatchObject({
      sourceId: "sc:11",
      title: "Cloud Track",
      artists: ["artist-z"],
      durationMs: 190000,
    });
    expect(parsed.tracks[0].coverUrl).toBe("https://i1.sndcdn.com/art-1-t500x500.jpg");
  });

  it("throws no_tracks without hydration", () => {
    expect(() => parseSoundCloudPage("<html>nothing</html>")).toThrow(LocalImportError);
  });
});

describe("parseSpotifyPage", () => {
  it("throws spotify_unavailable when no track data is embedded", () => {
    try {
      parseSpotifyPage(wrapScript("__NEXT_DATA__", { props: { pageProps: {} } }));
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LocalImportError);
      expect((err as LocalImportError).code).toBe("spotify_unavailable");
    }
  });
});

describe("parsePageForKind", () => {
  it("rejects unsupported sources", () => {
    try {
      parsePageForKind("vk", "<html>", "https://vk.com/x");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LocalImportError);
      expect((err as LocalImportError).code).toBe("unsupported_source");
    }
  });
});