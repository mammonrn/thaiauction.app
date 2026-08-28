"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side auth client.
 *
 * No baseURL is passed on purpose: the client defaults to the current origin,
 * and the API routes are same-origin. That keeps BETTER_AUTH_URL a server-only
 * value — it never has to be exposed as a NEXT_PUBLIC_* variable.
 */
export const authClient = createAuthClient();

export const { signIn, signOut, useSession } = authClient;
