import { api, type ApiTrack, type ImportReview, type SearchResponse } from "@/shared/api";
import type { ImportReviewReason } from "@/shared/contracts/imports";
import type { SourceTrackSeed } from "./parsers";

const STOPWORDS = new Set([
  "feat",
  "ft",
  "ft.",
  "featuring",
  "official",
  "music",
  "video",
  "audio",
  "lyrics",
  "officialaudio",
  "officialvideo",
  "officiallyrics",
  "hq",
  "hd",
  "4k",
  "topic",
  "with",
  "the",
  "and",
  "x",
]);

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[ё]/g, "е")
    .replace(/[^a-z0-9а-я ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeTitle(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !STOPWORDS.has(token));
}

function unionSize(a: Set<string>, b: Set<string>): number {
  const out = new Set(a);
  for (const item of b) out.add(item);
  return out.size;
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  if (sa.size === 0 || sb.size === 0) return 0;
  const inter = new Set([...sa].filter((x) => sb.has(x)));
  return inter.size / unionSize(sa, sb);
}

function titleSimilarity(seed: string, candidate: string): number {
  const a = tokenize(seed);
  const b = tokenize(candidate);
  if (a.length === 0 || b.length === 0) {
    const nSeed = normalizeTitle(seed);
    const nCand = normalizeTitle(candidate);
    if (nSeed.length > 0 && nSeed === nCand) return 1;
    if (nSeed.length > 0 && (nSeed.includes(nCand) || nCand.includes(nSeed))) return 0.6;
    return 0;
  }
  const base = jaccard(a, b);
  const containment =
    a.every((x) => b.includes(x)) || b.every((x) => a.includes(x)) ? 1 : 0;
  return Math.max(base, containment === 1 ? (base * 0.6 + 0.4) : base);
}

function artistScore(seedArtists: string[], candidateArtists: string[]): number {
  const a = new Set(seedArtists.flatMap((artist) => tokenize(artist)));
  const b = new Set(candidateArtists.flatMap((artist) => tokenize(artist)));
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const inter = new Set([...a].filter((x) => b.has(x)));
  return inter.size / unionSize(a, b);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function scoreCandidate(
  seed: SourceTrackSeed,
  candidate: { title: string; artists: string[]; durationMs?: number },
): number {
  const titleSim = titleSimilarity(seed.title, candidate.title);
  const artistsSim = artistScore(seed.artists, candidate.artists);
  let score = clamp01(titleSim * 0.7 + artistsSim * 0.3);
  if (
    seed.durationMs &&
    candidate.durationMs &&
    seed.durationMs > 0 &&
    candidate.durationMs > 0
  ) {
    const ratio = Math.max(seed.durationMs, candidate.durationMs) / Math.min(seed.durationMs, candidate.durationMs);
    if (ratio > 1.6) {
      score = clamp01(score - 0.2);
    }
  }
  return score;
}

function decideReason(score: number | undefined): { reason: ImportReviewReason; proposed: ApiTrack | undefined; score: number | undefined } {
  if (score === undefined) return { reason: "no_catalog_candidates", proposed: undefined, score: undefined };
  if (score >= 0.72) return { reason: "auto_matched", proposed: undefined, score: Math.round(score * 100) };
  if (score >= 0.4) return { reason: "low_confidence_match", proposed: undefined, score: Math.round(score * 100) };
  return { reason: "no_catalog_candidates", proposed: undefined, score: undefined };
}

function toCandidate(track: ApiTrack): { title: string; artists: string[]; durationMs?: number } {
  return {
    title: track.title,
    artists: Array.isArray(track.artists)
      ? track.artists.map((a: any) => typeof a?.name === "string" ? a.name : String(a))
      : [],
    durationMs: track.durationMs,
  };
}

function dedupeProposals(proposals: ApiTrack[]): ApiTrack[] {
  const seen = new Set<string>();
  const out: ApiTrack[] = [];
  for (const track of proposals) {
    if (!track?.id || seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(track);
  }
  return out;
}

export type SearchTracksFn = (query: string) => Promise<SearchResponse>;

export async function matchSeedsToCatalog(
  seeds: SourceTrackSeed[],
  searchFn: SearchTracksFn = (query) => api.search(query, "track"),
  concurrency = 6,
): Promise<ImportReview[]> {
  const reviews: ImportReview[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < seeds.length; i += concurrency) {
    const chunk = seeds.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (seed): Promise<{ seed: SourceTrackSeed; index: number; proposed?: ApiTrack; score?: number; reason: ImportReviewReason }> => {
        const query = `${seed.artists[0] ?? ""} ${seed.title}`.trim().slice(0, 90);
        const candidates: ApiTrack[] = [];
        try {
          const res = await searchFn(query);
          const items = Array.isArray(res?.items) ? res.items : [];
          candidates.push(...dedupeProposals(items.filter((item) => (item as any).type === "track") as ApiTrack[]));
        } catch {
          return { seed, index: seeds.indexOf(seed), reason: "catalog_lookup_failed" };
        }
        if (candidates.length === 0) {
          return { seed, index: seeds.indexOf(seed), reason: "no_catalog_candidates" };
        }
        let best: ApiTrack | undefined;
        let bestScore = -1;
        for (const candidate of candidates) {
          const score = scoreCandidate(seed, toCandidate(candidate));
          if (score > bestScore) {
            bestScore = score;
            best = candidate;
          }
        }
        const decision = decideReason(bestScore >= 0 ? bestScore : undefined);
        return {
          seed,
          index: seeds.indexOf(seed),
          proposed: bestScore >= 0.4 ? best : undefined,
          score: bestScore >= 0.4 ? decision.score : undefined,
          reason: decision.reason,
        };
      }),
    );

    for (const result of results) {
      reviews.push({
        id: `${result.seed.sourceId}:${result.index}`,
        sourceTrack: {
          sourceId: result.seed.sourceId,
          title: result.seed.title,
          artists: result.seed.artists,
          durationMs: result.seed.durationMs,
          coverUrl: result.seed.coverUrl,
        },
        proposedTrack: result.proposed,
        score: result.score,
        reason: result.reason,
        status: "pending",
        position: result.index,
        createdAt: now,
      });
    }
  }

  return reviews;
}