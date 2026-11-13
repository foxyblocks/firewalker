/**
 * Downloads the pattern catalog's text for `PatternLibrary` (core/patternLibrary.ts).
 *
 * On an iPhone this goes through Capacitor's native HTTP (CapacitorHttp), not the WebView's
 * fetch. The CDN doesn't send CORS headers, and the WebView's origin is capacitor://localhost,
 * so a WebView fetch would be refused; a native request has no origin to check. In Chrome
 * (`bun run dev:native`), the catalog comes from the dev server instead (build/catalog.ts), on
 * the page's own origin, so plain fetch works.
 */
import { Capacitor, CapacitorHttp } from "@capacitor/core";

export async function fetchCatalogText(url: string, timeoutMs: number): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.get({ url, connectTimeout: timeoutMs, readTimeout: timeoutMs, responseType: "text" });
    if (response.status !== 200) throw new Error(`The catalog download failed (${response.status}).`);
    // A JSON content type comes back already parsed, whatever responseType says.
    return typeof response.data === "string" ? response.data : JSON.stringify(response.data);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-cache" });
    if (!response.ok) throw new Error(`The catalog download failed (${response.status}).`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where the catalog comes from: the CDN on a phone or in the Simulator, and the dev server's live
 * copy of patterns/ in Chrome, where the CDN's missing CORS headers would block it.
 */
export function catalogUrl(cdnUrl: string): string {
  return Capacitor.isNativePlatform() ? cdnUrl : "./catalog.json";
}
