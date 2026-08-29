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
  /// Instalments only, and only once the plan is accepted: what the interest
  /// cost over the term. Zero on a pending charge.
  interest: number | null;
  interest_vat: number | null;
  failure_code: string | null;
  failure_message: string | null;
  expires_at: string | null;
  /// Where the buyer must go to authorise. Present on every redirect-based
  /// method (instalments, ShopeePay) and absent on card and PromptPay.
  authorize_uri: string | null;
  return_uri: string | null;
  /// Whatever we sent at creation. Always carries `paymentId`, which is how the
  /// reconcile sweep re-attaches an orphaned charge to its row.
  metadata: Record<string, string> | null;
  source: {
    id: string;
    type: string;
    installment_term?: number | null;
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
 * Create an instalment source for one issuer and term.
 *
 * Server-side for the same reason PromptPay is: the amount comes from the
 * auction row. The TERM is the one thing a buyer legitimately chooses, and it
 * is checked against what this marketplace offered before it gets here — see
 * isOfferedInstallment.
 *
 * `zero_interest_installments` is deliberately NOT sent. The account default
 * is false (confirmed on GET /capability), which means the buyer carries the
 * interest and the marketplace's cost is the same as an ordinary card. Sending
 * true would move that cost onto us.
 */
export async function createInstallmentSource(params: {
  amountSatang: number;
  bankCode: string;
  term: number;
}): Promise<OmiseSource> {
  assertUsableKey();
  return request<OmiseSource>("/sources", {
    method: "POST",
    body: {
      amount: String(params.amountSatang),
      currency: "THB",
      type: `installment_${params.bankCode}`,
      installment_term: String(params.term),
    },
  });
}

/**
 * Create a ShopeePay source.
 *
 * `shopeepay_jumpapp` rather than `shopeepay`: the jump-app variant opens the
 * ShopeePay app directly, which is the only sensible flow on a phone, and this
 * method is offered on phones only. The QR variant would put a second QR
 * alongside PromptPay's for no gain.
 *
 * `platform_type` is required by the jump-app source and tells Omise which
 * app-store link to fall back to when the app is not installed.
 */
export async function createShopeePaySource(params: {
  amountSatang: number;
  platform: "IOS" | "ANDROID";
}): Promise<OmiseSource> {
  assertUsableKey();
  return request<OmiseSource>("/sources", {
    method: "POST",
    body: {
      amount: String(params.amountSatang),
      currency: "THB",
      type: "shopeepay_jumpapp",
      platform_type: params.platform,
    },
  });
}

/**
 * Charge a redirect source (instalments, ShopeePay), returning authorize_uri.
 *
 * `return_uri` is where Omise sends the buyer back to. It must be absolute and
 * HTTPS in production; it is NOT trusted as a statement of what happened —
 * the return page re-reads the charge from Omise like every other status in
 * this project.
 *
 * `expires_at` is sent but is honoured only for ShopeePay. Verified against
 * the TEST API: a ShopeePay charge asked for a 45-minute window gets exactly
 * that, while an instalment charge ignores it and keeps Omise's 7-day default.
 * Neither the charges API reference nor the ShopeePay guide document this
 * correctly — the guide claims a 60-minute default and that expires_at cannot
 * be set at all. See expireCharge for how the instalment case is handled.
 */
export async function chargeRedirectSource(params: {
  amountSatang: number;
  sourceId: string;
  description: string;
  returnUri: string;
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
      return_uri: params.returnUri,
      expires_at: params.expiresAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
      ...metadataFields(params.metadata),
    },
  });
}

/**
 * Expire a pending charge now.
 *
 * This is what releases the auction's one-pending-attempt slot when a buyer
 * backs out of a ShopeePay payment.
 *
 * SHOPEEPAY ONLY. The charges API reference lists the source types this
 * endpoint supports and includes neither ShopeePay nor instalments; tried
 * against the TEST API, `shopeepay_jumpapp` is accepted and returns status
 * `expired`, while an instalment charge is refused outright with
 * "expiring is not supported for chrg_...".
 *
 * That asymmetry is why the two methods behave differently when a buyer backs
 * out — see cancelRedirectAttempt in lib/payments.ts. Because ShopeePay's
 * support here is undocumented it could be withdrawn, so callers treat a
 * refusal as survivable rather than as an error.
 */
export async function expireCharge(chargeId: string): Promise<OmiseCharge> {
  assertUsableKey();
  return request<OmiseCharge>(
    `/charges/${encodeURIComponent(chargeId)}/expire`,
    { method: "POST" },
  );
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

/* ------------------------------------------------- recipients and transfers */

/**
 * A payout destination at Omise: one seller's bank account, mirrored.
 *
 * `verified` and `active` are separate booleans and BOTH matter. Verified means
 * Omise believes the account details; active means it may receive money. A
 * transfer to a recipient that is verified but not active is accepted by the
 * API and comes back with `sendable: false` — it would sit there forever. See
 * `recipientUsable`.
 */
export type OmiseRecipient = {
  object: "recipient";
  id: string;
  livemode: boolean;
  deleted: boolean;
  verified: boolean;
  active: boolean;
  /// Omise's code when it rejects the details. Null while it is still deciding.
  failure_code: string | null;
  verified_at: string | null;
  activated_at: string | null;
  type: "individual" | "corporation";
  name: string;
  email: string | null;
  bank_account: {
    brand: string | null;
    bank_code: string | null;
    last_digits: string | null;
    name: string;
  } | null;
};

/**
 * Money on its way to a recipient.
 *
 * `net` is what LANDS in the bank account: Omise takes `total_fee` out of
 * `amount`, it does not bill it separately. Verified against the TEST API —
 * amount 10000 comes back fee 1869, fee_vat 131, total_fee 2000, net 8000.
 * Every figure this project records about a transfer comes from here rather
 * than from arithmetic, for the same reason the charge figures do.
 */
export type OmiseTransfer = {
  object: "transfer";
  id: string;
  livemode: boolean;
  deleted: boolean;
  /// Whether Omise will actually send it. False for an inactive recipient and
  /// false when the balance will not cover it — neither is reported as an
  /// error at creation time, so this is the only signal that a transfer is
  /// stillborn.
  sendable: boolean;
  sent: boolean;
  paid: boolean;
  amount: number;
  fee: number;
  fee_vat: number;
  total_fee: number;
  net: number;
  currency: string;
  recipient: string;
  failure_code: string | null;
  failure_message: string | null;
  sent_at: string | null;
  paid_at: string | null;
  created_at: string;
  metadata: Record<string, string> | null;
};

/** Whether a transfer to this recipient would actually go out. */
export function recipientUsable(recipient: OmiseRecipient): boolean {
  return recipient.verified && recipient.active && !recipient.deleted;
}

/**
 * Create a payout destination for one seller.
 *
 * `type` is always `individual`: this marketplace's sellers are people, and a
 * corporation recipient additionally needs a tax id that nothing in the app
 * collects. If business sellers are ever onboarded this is where that starts.
 *
 * The bank code is this project's own identifier from lib/thai-banks.ts, which
 * is already the Omise `bank_account[brand]` vocabulary — "kbank", "bbl",
 * "scb" — so no translation table stands between the two.
 */
export async function createRecipient(params: {
  name: string;
  email: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
}): Promise<OmiseRecipient> {
  assertUsableKey();
  return request<OmiseRecipient>("/recipients", {
    method: "POST",
    body: {
      name: params.name,
      type: "individual",
      email: params.email,
      "bank_account[brand]": params.bankCode,
      "bank_account[number]": params.accountNumber,
      "bank_account[name]": params.accountName,
    },
  });
}

/** Re-read a recipient. The authority on whether it can be paid to. */
export async function retrieveRecipient(
  recipientId: string,
): Promise<OmiseRecipient> {
  return request<OmiseRecipient>(
    `/recipients/${encodeURIComponent(recipientId)}`,
    { method: "GET" },
  );
}

/**
 * Send money to a recipient.
 *
 * `amount` is what is TAKEN from the marketplace balance; Omise deducts its fee
 * from it and the recipient receives `net`. So the caller asks for
 * `sellerNet + transferFee` — see lib/payout-math.ts.
 *
 * A creation that succeeds is NOT a transfer that will happen: an inactive
 * recipient or an insufficient balance both return HTTP 200 with
 * `sendable: false`, verified against the TEST API. Callers must read it.
 *
 * Metadata carries the payment row id for the same reason charges do: it is
 * how the reconcile sweep re-attaches a transfer whose id was never stored
 * because the process died between the call and the write.
 */
export async function createTransfer(params: {
  amountSatang: number;
  recipientId: string;
  metadata: Record<string, string>;
}): Promise<OmiseTransfer> {
  assertUsableKey();
  return request<OmiseTransfer>("/transfers", {
    method: "POST",
    body: {
      amount: String(params.amountSatang),
      recipient: params.recipientId,
      ...metadataFields(params.metadata),
    },
  });
}

/** Re-read a transfer. THE authority on whether the seller has been paid. */
export async function retrieveTransfer(
  transferId: string,
): Promise<OmiseTransfer> {
  return request<OmiseTransfer>(
    `/transfers/${encodeURIComponent(transferId)}`,
    { method: "GET" },
  );
}

/**
 * List transfers in a window.
 *
 * The transfer half of `listCharges`, and there for the same one reason: a
 * crash between "Omise created the transfer" and "we wrote down its id" leaves
 * real money moving with no local record. Every transfer carries its payment
 * row id in metadata, so the sweep can find it here and adopt it.
 */
export async function listTransfers(params: {
  from: Date;
  to: Date;
  limit?: number;
}): Promise<{ object: "list"; data: OmiseTransfer[]; total: number }> {
  const query = new URLSearchParams({
    from: params.from.toISOString(),
    to: params.to.toISOString(),
    limit: String(params.limit ?? 100),
    order: "reverse_chronological",
  });
  return request(`/transfers?${query.toString()}`, { method: "GET" });
}
