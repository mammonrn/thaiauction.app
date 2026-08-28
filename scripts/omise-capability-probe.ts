/**
 * Feasibility probe: what can this Omise account actually accept?
 *
 * Read-only against our own systems. It imports NOTHING from lib/payments.ts
 * or lib/omise.ts and never touches the database — the live checkout flow is
 * not in scope for a spike, so this script cannot disturb it even by accident.
 *
 * Against Omise it does two things:
 *   1. GET /capability — the authoritative list of what is switched on for
 *      this account, rather than what the docs say exists in general.
 *   2. For installments and ShopeePay, if and only if capability reports them
 *      enabled, create a real source + charge in TEST mode and print the
 *      response, including the authorize_uri both methods redirect to.
 *
 *   OMISE_PUBLIC_KEY=pkey_test_... OMISE_SECRET_KEY=skey_test_... \
 *     npx tsx scripts/omise-capability-probe.ts
 *
 * Test keys only. The script refuses to run against a live key: this creates
 * charges, and a spike has no business doing that with real money.
 */

const API = "https://api.omise.co";

type PaymentMethod = {
  object: "payment_method";
  name: string;
  currencies: string[];
  card_brands: string[] | null;
  installment_terms: number[] | null;
  banks: string[] | null;
  provider: string | null;
};

type Capability = {
  object: "capability";
  country: string;
  banks: string[];
  zero_interest_installments: boolean;
  /// `max` is genuinely absent on installment_amount — only a floor is
  /// published, and the global charge_amount ceiling applies above it.
  limits: Record<string, { min: number; max?: number }>;
  payment_methods: PaymentMethod[];
  tokenization_methods: (string | null)[];
};

function requireTestKey(name: "OMISE_PUBLIC_KEY" | "OMISE_SECRET_KEY"): string {
  const key = process.env[name];
  if (!key) throw new Error(`${name} is not set`);

  const expected = name === "OMISE_PUBLIC_KEY" ? "pkey_test_" : "skey_test_";
  if (!key.startsWith(expected)) {
    throw new Error(
      `${name} must be a TEST key (${expected}…). This script creates charges and will not run against live keys.`,
    );
  }
  return key;
}

function basic(key: string): string {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

async function call<T>(
  path: string,
  key: string,
  body?: Record<string, string>,
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: basic(key),
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  });
  return (await response.json()) as T;
}

/**
 * The fields that decide feasibility, rather than a truncated JSON blob —
 * truncation hid `authorize_uri` and `status` on the first run.
 */
function summarise(o: Record<string, unknown>): string {
  if (o.object === "error") return `ERROR ${o.code} — ${o.message}`;
  const keep = [
    "id", "object", "status", "flow", "installment_term", "absorption_type",
    "amount", "fee", "fee_vat", "interest", "interest_vat", "net",
    "authorize_uri", "expires_at",
  ];
  return keep
    .filter((k) => o[k] !== undefined && o[k] !== null)
    .map((k) => `${k}=${String(o[k])}`)
    .join(" ");
}

const baht = (satang: number) =>
  `฿${(satang / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

async function main() {
  const publicKey = requireTestKey("OMISE_PUBLIC_KEY");
  const secretKey = requireTestKey("OMISE_SECRET_KEY");

  // ---- 1. Which key does /capability actually accept? --------------------
  // The docs say public-key-only; worth confirming rather than assuming.
  console.log("=== GET /capability ===");
  for (const [label, key] of [
    ["public key", publicKey],
    ["secret key", secretKey],
  ] as const) {
    const result = await call<{ object?: string; code?: string }>(
      "/capability",
      key,
    );
    console.log(
      `  with ${label}: ${result.object === "capability" ? "OK" : `REFUSED (${result.code ?? "unknown"})`}`,
    );
  }

  const cap = await call<Capability>("/capability", publicKey);
  if (cap.object !== "capability") {
    console.error("capability lookup failed:", cap);
    process.exit(1);
  }

  console.log(`\n  country: ${cap.country}`);
  console.log(`  zero_interest_installments: ${cap.zero_interest_installments}`);
  console.log("  limits:");
  for (const [name, range] of Object.entries(cap.limits ?? {})) {
    console.log(
      `    ${name.padEnd(20)} ${baht(range.min)} – ${range.max === undefined ? "(no ceiling published)" : baht(range.max)}`,
    );
  }

  // ---- 2. What is switched on -------------------------------------------
  console.log(`\n=== payment_methods enabled (${cap.payment_methods.length}) ===`);
  for (const method of [...cap.payment_methods].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const terms = method.installment_terms?.length
      ? ` terms=[${method.installment_terms.join(",")}]`
      : "";
    const banks = method.banks?.length ? ` banks=${method.banks.length}` : "";
    console.log(
      `  ${method.name.padEnd(28)} ${method.currencies.join(",")}${terms}${banks}`,
    );
  }

  const installments = cap.payment_methods.filter((m) =>
    m.name.startsWith("installment_"),
  );
  const shopee = cap.payment_methods.filter((m) => m.name.startsWith("shopeepay"));

  console.log("\n=== the two methods under investigation ===");
  console.log(
    `  installment_*: ${installments.length ? installments.map((m) => m.name).join(", ") : "NOT ENABLED on this account"}`,
  );
  console.log(
    `  shopeepay*:    ${shopee.length ? shopee.map((m) => m.name).join(", ") : "NOT ENABLED on this account"}`,
  );

  // ---- 3. Try them for real, but only if they are actually on -----------
  // No workarounds: if capability does not list a method, creating a source
  // for it would just produce a misleading error, so it is not attempted.
  const RETURN_URI = "https://thaiauction.app/payments/return";

  for (const method of installments) {
    const term = method.installment_terms?.[0];
    if (!term) continue;
    // Above the documented ฿2,000 floor, and comfortably above the per-month
    // minimum for the longest term this bank offers.
    const amount = 500_000;

    console.log(`\n=== live test: ${method.name} (term ${term}) ===`);
    const source = await call<Record<string, unknown>>("/sources", secretKey, {
      amount: String(amount),
      currency: "THB",
      type: method.name,
      installment_term: String(term),
      platform_type: "WEB",
    });
    console.log("  source:", summarise(source));

    if (typeof source.id !== "string") continue;
    // NOTE: if zero_interest_installments is sent here it must ALSO be sent on
    // the charge below. Sending it on only one of the two is rejected with
    // "one or more charge parameters don't match source parameters".
    const charge = await call<Record<string, unknown>>("/charges", secretKey, {
      amount: String(amount),
      currency: "THB",
      source: source.id,
      return_uri: RETURN_URI,
    });
    console.log("  charge:", summarise(charge));
  }

  for (const method of shopee) {
    const amount = 50_000;
    console.log(`\n=== live test: ${method.name} ===`);
    const source = await call<Record<string, unknown>>("/sources", secretKey, {
      amount: String(amount),
      currency: "THB",
      type: method.name,
      "platform_type": "WEB",
    });
    console.log("  source:", summarise(source));

    if (typeof source.id !== "string") continue;
    const charge = await call<Record<string, unknown>>("/charges", secretKey, {
      amount: String(amount),
      currency: "THB",
      source: source.id,
      return_uri: RETURN_URI,
    });
    console.log("  charge:", summarise(charge));
  }

  // ---- 4. What the current checkout already supports, for comparison ----
  console.log("\n=== for reference: what we accept today ===");
  const ours = cap.payment_methods
    .filter((m) => m.name === "card" || m.name === "promptpay")
    .map((m) => m.name);
  console.log(`  implemented in lib/payments.ts: ${ours.join(", ") || "none found"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
