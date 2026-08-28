/**
 * Comparing Thai personal names.
 *
 * Two places need to ask "are these the same person?" — the shill check, which
 * compares a bidder's KYC name against the seller's, and the payout screen,
 * which compares a bank account holder against the name that passed KYC.
 *
 * Thai names resist exact comparison. A bank prints "นาย สมชาย ใจดี" where the
 * KYC form holds "สมชาย"/"ใจดี"; spacing between given and family name is
 * inconsistent; and Latin-script names vary in case. So both callers compare
 * NORMALISED forms, and neither treats a mismatch as proof of anything — the
 * shill check errs toward refusing a bid, the payout check only raises a flag
 * for a human.
 */

/**
 * Honorifics stripped before comparing. Only leading titles: a title is not
 * part of the name, but a word that merely looks like one in the middle of a
 * name might be.
 */
const TITLES = [
  "นาย",
  "นางสาว",
  "นาง",
  "น.ส.",
  "นส.",
  "ด.ช.",
  "ด.ญ.",
  "ดร.",
  "mr.",
  "mr",
  "mrs.",
  "mrs",
  "ms.",
  "ms",
  "miss",
  "dr.",
  "dr",
];

/**
 * Reduce a name to a comparable form: no honorific, no punctuation, no
 * whitespace, lower case.
 *
 * Whitespace is removed rather than collapsed because Thai does not put spaces
 * between words at all — "สมชายใจดี" and "สมชาย ใจดี" are the same name
 * written two ways, and only one of them will match what a bank prints.
 */
export function normaliseThaiName(value: string): string {
  let name = value.trim().toLowerCase();

  // Strip one leading title, longest first so "นางสาว" is not read as "นาง".
  for (const title of [...TITLES].sort((a, b) => b.length - a.length)) {
    if (name.startsWith(title)) {
      name = name.slice(title.length);
      break;
    }
  }

  return name.replace(/[\s.,\-_'"]/g, "");
}

/**
 * Do these refer to the same person, allowing for how the name was written?
 *
 * The KYC side supplies given and family name separately; the other side is
 * usually one string. Both orderings are accepted because Thai bank statements
 * are not consistent about which comes first.
 */
export function namesMatch(
  kyc: { firstName: string; lastName: string },
  otherFullName: string,
): boolean {
  const other = normaliseThaiName(otherFullName);
  if (!other) return false;

  const first = normaliseThaiName(kyc.firstName);
  const last = normaliseThaiName(kyc.lastName);
  if (!first || !last) return false;

  return other === first + last || other === last + first;
}
