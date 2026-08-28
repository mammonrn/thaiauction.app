import "server-only";

/**
 * Thaibulksms OTP API client.
 *
 * Contract taken from Thaibulksms' own OTP manual
 * (https://assets.thaibulksms.com/documents/Thaibulksms-otp.pdf) and their
 * official Node client `thaibulksms-api`, published by 1Moby Co., Ltd. — the
 * company that owns Thaibulksms. Both agree on endpoints and field names:
 *
 *   POST https://otp.thaibulksms.com/v2/otp/request  { key, secret, msisdn }
 *     -> { status: "success", token: "...", refno: "190IB" }
 *
 *   POST https://otp.thaibulksms.com/v2/otp/verify   { key, secret, token, pin }
 *     -> { status: "success", message: "Code is correct." }
 *
 * Errors come back as HTTP 4xx/5xx with messages such as "Code is invalid.",
 * "Token is expire." and "Application not found.", plus coded errors including
 * ERROR_MSISDN_EXCEEDED_LIMIT (115) and ERROR_INSUFFICIENT_CREDIT (116, HTTP 423).
 *
 * Note this is a DIFFERENT product from the Send-SMS API: that one lives at
 * api-v2.thaibulksms.com and uses HTTP Basic auth, whereas the OTP endpoints
 * take the credentials in the request body. The OTP key/secret are issued
 * separately, in the OTP console at otp-manager.thaibulksms.com — the SMS API
 * key will not work here.
 *
 * The manual's PHP sample posts form fields while the vendor's Node client
 * posts JSON; both are vendor-published, so the API accepts either. JSON is
 * used here.
 */

const OTP_BASE_URL = "https://otp.thaibulksms.com/v2";
const REQUEST_TIMEOUT_MS = 15_000;

export type OtpRequestResult = {
  token: string;
  refno: string;
};

/** A failure we can describe to the user without leaking provider internals. */
export class ThaibulksmsError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "invalid_pin"
      | "expired"
      | "rate_limited"
      | "no_credit"
      | "misconfigured"
      | "unavailable",
  ) {
    super(message);
    this.name = "ThaibulksmsError";
  }
}

/**
 * Stub mode for local and staging testing.
 *
 * Every OTP send costs real SMS credit, and Thaibulksms — not this app —
 * generates the PIN, so there is no way to log the real code during testing.
 * In stub mode the provider is never called and STUB_PIN is accepted instead.
 *
 * The switch is not a boolean and is deliberately not tied to NODE_ENV:
 * `next start` runs with NODE_ENV=production by definition, so a NODE_ENV gate
 * would make stub mode unusable on exactly the staging build where it is
 * wanted, while doing nothing that this gate does not already do. Instead the
 * variable must spell out the consequence, so no plausible typo, leftover "1"
 * or copied boolean can silently disable SMS verification. Every stubbed call
 * also logs a warning, so a host running like this is obvious in the logs.
 */
const STUB_PIN = "000000";
const STUB_ACKNOWLEDGEMENT = "stub-sms-no-real-otp";

function stubModeEnabled(): boolean {
  const value = process.env.OTP_STUB_MODE;
  if (!value) return false;

  if (value !== STUB_ACKNOWLEDGEMENT) {
    throw new ThaibulksmsError(
      `OTP_STUB_MODE must be exactly "${STUB_ACKNOWLEDGEMENT}" to take effect`,
      "misconfigured",
    );
  }

  console.warn(
    "[thaibulksms] STUB MODE ACTIVE — no SMS is being sent and any OTP check " +
      "accepts a fixed code. This must never be set on production.",
  );
  return true;
}

export function isStubMode(): boolean {
  return stubModeEnabled();
}

function credentials(): { key: string; secret: string } {
  const key = process.env.THAIBULKSMS_API_KEY;
  const secret = process.env.THAIBULKSMS_API_SECRET;

  // Both are required: every OTP call carries key AND secret in its body.
  if (!key || !secret) {
    throw new ThaibulksmsError(
      "THAIBULKSMS_API_KEY and THAIBULKSMS_API_SECRET must both be set",
      "misconfigured",
    );
  }

  return { key, secret };
}

async function postJson(
  path: string,
  body: Record<string, string>,
): Promise<{ ok: boolean; status: number; payload: Record<string, unknown> }> {
  const response = await fetch(`${OTP_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    // A non-JSON body (gateway HTML error page) leaves payload empty; the
    // status code below still classifies it.
  }

  return { ok: response.ok, status: response.status, payload };
}

/**
 * The manual documents a flat body, while the vendor's Node client's README
 * shows one nested under `data`. Accept either rather than betting on one.
 */
function unwrap(payload: Record<string, unknown>): Record<string, unknown> {
  const inner = payload.data;
  return inner && typeof inner === "object"
    ? (inner as Record<string, unknown>)
    : payload;
}

function providerMessage(payload: Record<string, unknown>): string {
  const body = unwrap(payload);
  const message = body.message ?? payload.message;
  if (typeof message === "string") return message;

  const errors = payload.errors;
  if (Array.isArray(errors) && errors.length > 0) return JSON.stringify(errors[0]);

  return "";
}

function classify(status: number, message: string): ThaibulksmsError {
  const lower = message.toLowerCase();

  if (lower.includes("code is invalid")) {
    return new ThaibulksmsError("รหัส OTP ไม่ถูกต้อง", "invalid_pin");
  }
  if (lower.includes("expire")) {
    return new ThaibulksmsError("รหัส OTP หมดอายุแล้ว", "expired");
  }
  if (lower.includes("application not found")) {
    // Bad or mismatched OTP key/secret — an operator problem, not the user's.
    return new ThaibulksmsError("ตั้งค่า Thaibulksms ไม่ถูกต้อง", "misconfigured");
  }
  if (status === 423 || lower.includes("credit")) {
    return new ThaibulksmsError("เครดิต SMS ไม่พอ", "no_credit");
  }
  if (lower.includes("exceeded")) {
    return new ThaibulksmsError("ขอรหัสถี่เกินไป", "rate_limited");
  }

  return new ThaibulksmsError("ส่ง SMS ไม่สำเร็จ", "unavailable");
}

/** Ask Thaibulksms to generate a PIN and text it to `msisdn`. */
export async function requestOtp(msisdn: string): Promise<OtpRequestResult> {
  if (stubModeEnabled()) {
    return {
      token: `stub-${crypto.randomUUID()}`,
      refno: "STUB",
    };
  }

  const { key, secret } = credentials();

  let result;
  try {
    result = await postJson("/otp/request", { key, secret, msisdn });
  } catch (error) {
    console.error("[thaibulksms] request failed:", error);
    throw new ThaibulksmsError("ติดต่อผู้ให้บริการ SMS ไม่ได้", "unavailable");
  }

  const body = unwrap(result.payload);

  if (!result.ok || body.status !== "success") {
    const message = providerMessage(result.payload);
    console.error(
      `[thaibulksms] request rejected: status=${result.status} message=${message}`,
    );
    throw classify(result.status, message);
  }

  const token = body.token;
  const refno = body.refno;

  if (typeof token !== "string" || token.length === 0) {
    console.error("[thaibulksms] request returned no token");
    throw new ThaibulksmsError("ส่ง SMS ไม่สำเร็จ", "unavailable");
  }

  return { token, refno: typeof refno === "string" ? refno : "" };
}

/**
 * Check a PIN against a token. Returns true when correct, false when the
 * provider says the code is wrong; throws for anything else so an outage is
 * never silently reported to the user as a wrong code.
 */
export async function verifyOtp(token: string, pin: string): Promise<boolean> {
  if (stubModeEnabled()) {
    return pin === STUB_PIN;
  }

  const { key, secret } = credentials();

  let result;
  try {
    result = await postJson("/otp/verify", { key, secret, token, pin });
  } catch (error) {
    console.error("[thaibulksms] verify failed:", error);
    throw new ThaibulksmsError("ติดต่อผู้ให้บริการ SMS ไม่ได้", "unavailable");
  }

  const body = unwrap(result.payload);
  if (result.ok && body.status === "success") return true;

  const message = providerMessage(result.payload);
  const error = classify(result.status, message);

  // A wrong PIN is an expected outcome, not an exception.
  if (error.kind === "invalid_pin") return false;

  console.error(
    `[thaibulksms] verify rejected: status=${result.status} message=${message}`,
  );
  throw error;
}
