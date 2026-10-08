/**
 * Normalizes a user-typed web address to an absolute http(s) URL, or null if it
 * can't be repaired. Handles a missing scheme ("delhivery.com") and a missing
 * colon ("http//delhivery.com").
 */
export function normalizeHttpUrl(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  let candidate = trimmed.replace(/^(https?)\/\//i, "$1://");
  if (!/^[a-z][a-z\d+.-]*:/i.test(candidate)) {
    candidate = `https://${candidate.replace(/^\/+/, "")}`;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}
