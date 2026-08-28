/**
 * Bidder names are shown partially masked in public bid history: enough to tell
 * bidders apart and see that real people are competing, without publishing who
 * is bidding on what. A full name plus a bid amount is an invitation to contact
 * the underbidder off-platform, or to work out a rival's budget.
 */
export function maskName(name: string): string {
  const characters = Array.from(name.trim());
  if (characters.length === 0) return "***";
  return `${characters[0]}***`;
}
