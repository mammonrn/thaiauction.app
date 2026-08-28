import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth";

/**
 * Catch-all mount point for every Better Auth endpoint
 * (/api/auth/sign-in/social, /api/auth/callback/google, /api/auth/sign-out, ...).
 *
 * The Google redirect URI registered in the Google Cloud console must point at
 * <BETTER_AUTH_URL>/api/auth/callback/google.
 */
export const { GET, POST } = toNextJsHandler(auth.handler);
