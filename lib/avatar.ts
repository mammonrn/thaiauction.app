import { imageUrl } from "@/lib/image-keys";

/**
 * Which picture to show for a person.
 *
 * An uploaded avatar wins over the one Google supplied at sign-in: the user
 * chose it deliberately and more recently. Null when they have neither, which
 * callers render as an initial.
 *
 * Client-safe — it only builds a URL — so the same rule applies on every
 * surface rather than each page deciding for itself.
 */
export function avatarUrl(user: {
  avatarKey?: string | null;
  image?: string | null;
}): string | null {
  if (user.avatarKey) return imageUrl(user.avatarKey);
  return user.image ?? null;
}
