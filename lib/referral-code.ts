/**
 * Invite codes, and the cookie that carries one between the click and the
 * sign-up. See lib/referral.ts for what the system as a whole does and does
 * NOT do — the short version being that it grants nothing.
 *
 * Split out from lib/referral.ts so proxy.ts can import it. That file runs at
 * the edge, where there is no database, and importing the half that talks to
 * Prisma would pull the whole client into a bundle that must not have it.
 * Nothing here touches a database or a request; it is string work and one
 * decision.
 */

/** Thirty days, in seconds, for the cookie's Max-Age. */
export const REFERRAL_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/** Where the code waits between the click and the sign-up. */
export const REFERRAL_COOKIE = "ta_ref";

/** The query parameter an invite link carries. */
export const REFERRAL_PARAM = "ref";

/**
 * The alphabet a code is drawn from.
 *
 * A-Z and 0-9 minus the pairs that get misread and mistyped: 0/O and 1/I/L.
 * Codes get read off a phone screen and typed into another one, or dictated
 * over the phone, and "was that an I or a 1" is a support conversation this
 * avoids by never producing either. 31 characters over 6 positions is about
 * 887 million codes, so collisions are rare and handled rather than designed
 * around.
 */
export const REFERRAL_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const REFERRAL_CODE_LENGTH = 6;

/**
 * Read a code the way a human might have passed it on.
 *
 * Lower case and stray spaces are the sender's formatting, not a different
 * code, so they are normalised away. Anything still not in the alphabet is
 * rejected here rather than reaching the database as a query for a code that
 * cannot exist.
 */
export function normaliseReferralCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  if (code.length !== REFERRAL_CODE_LENGTH) return null;
  for (const character of code) {
    if (!REFERRAL_ALPHABET.includes(character)) return null;
  }
  return code;
}

/**
 * Where the app lives.
 *
 * BETTER_AUTH_URL is already the app's canonical public origin — it is what
 * Google redirects back to — so the invite link uses it rather than introducing
 * a second variable that could disagree with the first.
 */
export function siteOrigin(): string {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return "https://thaiauction.app";
}

/** The link to hand out, e.g. https://thaiauction.app/?ref=K7QF3M */
export function referralLink(code: string, origin = siteOrigin()): string {
  return `${origin}/?${REFERRAL_PARAM}=${code}`;
}

/**
 * Decide what the ?ref= on this request should do to the cookie.
 *
 * This is where first-touch is actually decided, which makes it the thing worth
 * testing directly rather than through a browser.
 *
 * Returns the code to store, or null to leave whatever is already there alone.
 */
export function referralCookieUpdate(
  url: URL,
  existingCookie: string | null | undefined,
): string | null {
  const incoming = normaliseReferralCode(url.searchParams.get(REFERRAL_PARAM));
  if (!incoming) return null;

  // First touch wins. A valid cookie already here is somebody's credit, and a
  // later link does not take it from them.
  if (normaliseReferralCode(existingCookie)) return null;

  return incoming;
}
