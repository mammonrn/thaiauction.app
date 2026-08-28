import "server-only";

/**
 * Omise API client.
 *
 * Deliberately a thin wrapper over fetch rather than the omise npm package:
 * this project needs three calls, and a hand-written client makes it obvious
 * at a glance that the secret key never leaves this module and that every
 * amount sent to Omise came from the database rather than from a request body.
 *
 * Card data never passes through here. The browser tokenises with Omise.js
 * against the PUBLIC key and sends us only the resulting token id — the one
 * supported way to accept cards without a PCI-DSS licence.
 *
 * https://docs.omise.co/charges-api
 * https://docs.omise.co/api-authentication
 */

const DEFAULT_API_BASE = "https://api.omise.co";

/**
 * Where requests go.
 *
 * Overridable only so the payment flow can be exercised end to end against a
 * stub during development, and guarded so that is all it can ever do: an
 * override is IGNORED unless the secret key is a test key. A live key always
 * talks to Omise, whatever the environment says — an env var must not be able
 * to redirect real money to another host.
 */
function apiBase(): string {
  const override = process.env.OMISE_API_BASE;
  if (!override) return DEFAULT_API_BASE;

  if (!secretKey().startsWith("skey_test_")) {
    console.error("[omise] ignoring OMISE_API_BASE: live key in use");
    return DEFAULT_API_BASE;
  }
  return override.replace(/\/$/, "");
}

/** PromptPay's own limits, quoted in the Omise docs. Integer satang. */
export const PROMPTPAY_MIN_SATANG = 2_000;
export const PROMPTPAY_MAX_SATANG = 15_000_000;

/**
 * Read at call time, not at import time.
 *
 * An import-time read would run during `next build`, where the variable is
 * absent, and break the build for a value only ever needed at request time.
 */
function secretKey(): string {
  const key = process.env.OMISE_SECRET_KEY;
  if (!key) {
    throw new Error("OMISE_SECRET_KEY is not set");
  }
  return key;
}

/**
 * Refuse to run against live keys unless the deployment says it means it.
 *
 * Test keys are prefixed `skey_test_`. A live key in a development or test
 * environment would move real money, so it has to be opted into explicitly by
 * setting OMISE_ALLOW_LIVE=1 in production.
 */
export function assertUsableKey(): void {
  const key = secretKey();
  const isTestKey = key.startsWith("skey_test_");

  if (!isTestKey && process.env.OMISE_ALLOW_LIVE !== "1") {
    throw new Error(
      "Refusing to use a live Omise key: set OMISE_ALLOW_LIVE=1 to enable live charges",
    );
  }
}

/** The subset of the Charge object this project reads. */
export type OmiseCharge = {
  object: "charge";
  id: string;
  status: "pending" | "successful" | "failed" | "expired" | "reversed";
  paid: boolean;
  amount: number;
  currency: string;
  /// Populated once the charge settles. Omise's real numbers, never estimated.
  fee: number | null;
  fee_vat: number | null;
  net: number | null;
  funding_amount: number | null;
  failure_code: string | null;
  failure_message: string | null;
  expires_at: string | null;
  /// Whatever we sent at creation. Always carries `paymentId`, which is how the
  /// reconcile sweep re-attaches an orphaned charge to its row.
  metadata: Record<string, string> | null;
  source: {
    id: string;
    type: string;
    scannable_code?: {
      image?: { download_uri?: string | null } | null;
    } | null;
  } | null;
};

export type OmiseSource = { object: "source"; id: string; type: string };

type OmiseError = {
  object: "error";
  code: string;
  message: string;
};

export class OmiseApiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OmiseApiError";
    this.code = code;
  }
}

/**
 * One request to Omise.
 *
 * HTTP Basic with the secret key as the username and a blank password, exactly
 * as the authentication docs specify. `cache: "no-store"` because a payment
 * status must never be served from a cache.
 */
async function request<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: Record<string, string> },
): Promise<T> {
  const auth = Buffer.from(`${secretKey()}:`).toString("base64");

  const response = await fetch(`${apiBase()}${path}`, {
    method: init.method,
    headers: {
      Authorization: `Basic ${auth}`,
      ...(init.body
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    body: init.body ? new URLSearchParams(init.body).toString() : undefined,
    cache: "no-store",
  });

  const payload: unknown = await response.json();

  if (
    payload &&
    typeof payload === "object" &&
    (payload as { object?: string }).object === "error"
  ) {
    const error = payload as OmiseError;
    throw new OmiseApiError(error.code, error.message);
  }

  if (!response.ok) {
    throw new OmiseApiError("http_error", `Omise returned ${response.status}`);
  }

  return payload as T;
}

/**
 * Create a PromptPay source.
 *
 * Made server-side with the secret key rather than in the browser with the
 * public key, so the amount comes from the auction row and the browser never
 * gets to say what it owes.
 */
export async function createPromptPaySource(
  amountSatang: number,
): Promise<OmiseSource> {
  assertUsableKey();
  return request<OmiseSource>("/sources", {
    method: "POST",
    body: {
      amount: String(amountSatang),
      currency: "THB",
      type: "promptpay",
    },
  });
}

/**
 * Charge a card token produced by Omise.js in the browser.
 *
 * `capture` is left at its default of true: this is a one-off purchase, so
 * authorise-then-capture would only add a second step that can be forgotten.
 */
export async function chargeCardToken(params: {
  amountSatang: number;
  token: string;
  description: string;
  metadata: Record<string, string>;
}): Promise<OmiseCharge> {
  assertUsableKey();
  return request<OmiseCharge>("/charges", {
    method: "POST",
    body: {
      amount: String(params.amountSatang),
      currency: "THB",
      card: params.token,
      description: params.description,
      ...metadataFields(params.metadata),
    },
  });
}

/**
 * Charge a PromptPay source, producing the QR the buyer scans.
 *
 * `expires_at` is always set. Omise has no expire endpoint for PromptPay, so a
 * QR that has been handed out cannot be recalled — a short, gateway-enforced
 * window is what stops an abandoned QR blocking the auction indefinitely.
 */
export async function chargePromptPaySource(params: {
  amountSatang: number;
  sourceId: string;
  description: string;
  expiresAt: Date;
  metadata: Record<string, string>;
}): Promise<OmiseCharge> {
  assertUsableKey();
  return request<OmiseCharge>("/charges", {
    method: "POST",
    body: {
      amount: String(params.amountSatang),
      currency: "THB",
      source: params.sourceId,
      description: params.description,
      // ISO 8601 without milliseconds, the format the docs quote.
      expires_at: params.expiresAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      ...metadataFields(params.metadata),
    },
  });
}

/**
 * Retrieve a charge. THE authority on whether money moved.
 *
 * Every status transition this project records comes from here. Omise's own
 * PromptPay guidance is to retrieve the charge and confirm its status rather
 * than trusting a notification, and their webhook docs add that deliveries are
 * not guaranteed to be retried — so this project has no webhook endpoint at
 * all and treats this call as the single source of truth.
 */
export async function retrieveCharge(chargeId: string): Promise<OmiseCharge> {
  return request<OmiseCharge>(`/charges/${encodeURIComponent(chargeId)}`, {
    method: "GET",
  });
}

/**
 * List charges created in a time window.
 *
 * Used only by the reconcile sweep, to recover from the one gap a two-step
 * "create the charge, then record its id" cannot close on its own: a crash in
 * between leaves a real charge whose id we never stored. Every charge carries
 * its payment row id in metadata, so the sweep can find it here and adopt it
 * rather than leaving money unaccounted for.
 */
export async function listCharges(params: {
  from: Date;
  to: Date;
  limit?: number;
}): Promise<{ object: "list"; data: OmiseCharge[]; total: number }> {
  const query = new URLSearchParams({
    from: params.from.toISOString(),
    to: params.to.toISOString(),
    limit: String(params.limit ?? 100),
    order: "reverse_chronological",
  });
  return request(`/charges?${query.toString()}`, { method: "GET" });
}

/** Omise takes metadata as bracketed form fields: metadata[key]=value. */
function metadataFields(
  metadata: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [`metadata[${key}]`, value]),
  );
}

/** The PromptPay QR image, if this charge has one. */
export function promptPayQrUri(charge: OmiseCharge): string | null {
  return charge.source?.scannable_code?.image?.download_uri ?? null;
}
