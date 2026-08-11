import { AppError } from "../errors/app-error.js";

export type GoogleProfile = {
  sub: string;
  email: string;
  email_verified: boolean | string;
  name?: string;
  aud: string;
};

/**
 * Validates a Google ID token via Google's tokeninfo endpoint.
 * Sufficient for MVP; production can switch to offline JWKS verification.
 *
 * Shared by staff auth (auth.service.ts) and customer auth
 * (customer-auth.service.ts) so both flows verify tokens identically.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleProfile> {
  const url = new URL("https://oauth2.googleapis.com/tokeninfo");
  url.searchParams.set("id_token", idToken);

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new AppError(502, "Unable to reach Google token validation", "GOOGLE_UNREACHABLE");
  }

  if (!res.ok) {
    throw new AppError(401, "Invalid Google ID token", "INVALID_GOOGLE_TOKEN");
  }

  return (await res.json()) as GoogleProfile;
}
