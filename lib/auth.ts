import { APIError } from "@better-auth/core/error";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { banMessageFor, loginBan } from "@/lib/bans";
import { prisma } from "@/lib/prisma";
import { recordSignupReferral } from "@/lib/referral";
import { REFERRAL_COOKIE } from "@/lib/referral-code";

/**
 * Better Auth server instance.
 *
 * Every secret is read from the environment — nothing is hard-coded. The
 * variables below must exist in `.env` (see `.env.example`):
 *
 *   DATABASE_URL          used by lib/prisma.ts
 *   GOOGLE_CLIENT_ID      Google OAuth client
 *   GOOGLE_CLIENT_SECRET  Google OAuth client
 *   BETTER_AUTH_SECRET    read automatically by Better Auth
 *   BETTER_AUTH_URL       read automatically by Better Auth (baseURL)
 *
 * `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are picked up from the environment
 * by the library itself, so they are deliberately not repeated here. The Google
 * credentials are not auto-read and must be passed explicitly.
 */
export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    // The adapter addresses Prisma *model* names (prisma.user, prisma.session),
    // not SQL table names, and our models are singular (`model User`). The
    // @@map("users") in schema.prisma only renames the underlying table.
    usePlural: false,
  }),

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },

  emailAndPassword: {
    // Enables signing IN with a password...
    enabled: true,
    // ...but not signing UP with one. The only way to get a password is
    // `setPassword` on an account that already exists via Google, so every
    // account's email is Google-verified and the public /sign-up/email endpoint
    // stays closed.
    disableSignUp: true,
  },

  account: {
    accountLinking: {
      enabled: true,
      // Google is trusted: when it asserts the email is verified and a local
      // user with that (verified) email already exists, the Google identity is
      // linked to it instead of erroring or creating a duplicate row.
      //
      // `requireLocalEmailVerified` is intentionally left at its default
      // (true). It stops an attacker who pre-registered an unverified account
      // at the victim's address from having the victim's Google identity
      // linked into the attacker-owned row.
      trustedProviders: ["google"],
    },
  },

  databaseHooks: {
    user: {
      create: {
        /**
         * Credit whoever invited this account.
         *
         * At user CREATION, so every way in is covered by one hook: Google and
         * the password endpoint both end here, and a third provider added later
         * would too. The alternative — a call in each sign-in path — is the
         * arrangement that eventually misses one.
         *
         * Wrapped, and wrapped again inside `recordSignupReferral`. The account
         * exists by the time this runs; a referral that fails to record is a
         * loss, but refusing someone the account they just created because a
         * bookkeeping row would not write is a much larger one. Same trade
         * lib/notifications.ts makes.
         */
        async after(user, context) {
          try {
            const headers = context?.request?.headers;
            await recordSignupReferral({
              referredUserId: user.id,
              code: readCookie(headers?.get("cookie"), REFERRAL_COOKIE),
              // Kept for lib/fraud-signals.ts to group on later: one referrer
              // collecting several accounts from one origin is what a person
              // should look at.
              ipAddress:
                headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
              userAgent: headers?.get("user-agent") ?? null,
            });
          } catch (error) {
            console.error("[referral] sign-up hook failed:", error);
          }
        },
      },
    },

    session: {
      create: {
        /**
         * Refuse a session to an account under a login ban.
         *
         * At session CREATION, so the ban lands at the point of signing in
         * rather than being hidden from afterwards: no cookie is issued, and
         * Google and password sign-in are both covered because both end here.
         * Hiding the UI would leave a working session behind it.
         *
         * Expiry needs no sweep. `loginBan` only returns a ban that is still
         * in force, so the day one lapses the next attempt simply succeeds.
         */
        async before(session) {
          const ban = await loginBan(session.userId);
          if (!ban) return;

          throw APIError.from("FORBIDDEN", {
            message: banMessageFor(ban),
            code: "BANNED_USER",
          });
        },
      },
    },
  },

  // Must be last: lets Better Auth set cookies from Next.js Server Actions.
  plugins: [nextCookies()],
});

/**
 * One cookie out of a Cookie header.
 *
 * Hand-parsed because this runs inside Better Auth's own request handling,
 * where next/headers is not the thing holding the request — the header on the
 * context is. Only the first match counts, which is what a browser sends for a
 * cookie set once at one path.
 */
function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}
