const FETCH_ALLOWED_HOSTS: readonly string[] = [
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "soundcloud.com",
  "open.spotify.com",
];

const FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface FetchPageResponse {
  ok: boolean;
  status: number;
  finalUrl: string;
  text: string;
  sizeBytes: number;
  error?: string;
}

export function isAllowedPageHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return FETCH_ALLOWED_HOSTS.some(
    (allowed) => host === allowed || host.endsWith("." + allowed),
  );
}

export async function fetchPage(
  url: string,
  options?: { timeoutMs?: number; maxBytes?: number },
): Promise<FetchPageResponse> {
  const timeoutMs = options?.timeoutMs ?? 20000;
  const maxBytes = options?.maxBytes ?? 12 * 1024 * 1024;

  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("unsupported protocol");
  }
  if (!isAllowedPageHost(parsed.hostname)) {
    throw new Error("host not allowed");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": FETCH_UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      },
    });
    const declaredLength = res.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > maxBytes) {
      return { ok: false, status: res.status, finalUrl: res.url, text: "", sizeBytes: Number(declaredLength), error: "response too large" };
    }
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      return { ok: false, status: res.status, finalUrl: res.url, text: "", sizeBytes: buffer.byteLength, error: "response too large" };
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    return {
      ok: res.ok,
      status: res.status,
      finalUrl: res.url,
      text,
      sizeBytes: buffer.byteLength,
    };
  } finally {
    clearTimeout(timer);
  }
}