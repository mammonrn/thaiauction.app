import Link from "next/link";

import { BankAccountForm } from "@/components/bank-account-form";
import { isUnlocked, maskBankAccount } from "@/lib/bank-account";
import { recipientPayoutsEnabled } from "@/lib/payouts";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

/**
 * Where a seller's share is sent.
 *
 * Only ever the signed-in user's own account: the row is looked up by session
 * user id, and the Server Action writes by the same id, so there is no
 * identifier a visitor could substitute to read or change somebody else's.
 */
export default async function BankAccountPage() {
  const { user } = await requireSession("/account/bank");

  const [account, identity, verifiedPhoneCount, lastChange] = await Promise.all([
    prisma.sellerBankAccount.findUnique({
      where: { userId: user.id },
      select: {
        bankCode: true,
        accountNumber: true,
        accountName: true,
        nameMatchesKyc: true,
        unlockedUntil: true,
        recipientStatus: true,
        omiseRecipientId: true,
      },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { firstName: true, lastName: true },
    }),
    prisma.verifiedPhone.count({ where: { userId: user.id } }),
    prisma.bankAccountChange.findFirst({
      where: { userId: user.id },
      orderBy: { changedAt: "desc" },
      select: { changedAt: true },
    }),
  ]);

  const hasKycName = Boolean(identity.firstName && identity.lastName);
  // Only worth saying when there is an account to say it about, and only when
  // the automatic payout path is the live one — otherwise it describes a check
  // that is not happening.
  const showRecipient = recipientPayoutsEnabled() && account !== null;
  const unlocked = isUnlocked(account?.unlockedUntil ?? null);
  // While the account is locked its digits never leave the server: the form is
  // not rendered, so sending them as props would put the full number in the
  // page source for nothing.
  const editable = account === null || unlocked;

  return (
    <main className="flex w-full flex-col gap-5">
      <Link
        href="/account"
        className="text-sm text-ink/60 underline-offset-4 hover:underline sm:hidden"
      >
        ← บัญชีของฉัน
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">บัญชีธนาคาร</h1>
      </header>

      {hasKycName ? (
        <p className="rounded-lg border border-black/10 px-4 py-3 text-sm text-ink/70">
          ชื่อบัญชีต้องตรงกับ{" "}
          <strong>
            {identity.firstName} {identity.lastName}
          </strong>
        </p>
      ) : (
        <p className="rounded-lg border border-warning/35 bg-warning/8 px-4 py-3 text-sm text-warning">
          ต้องยืนยันตัวตนก่อนจึงจะรับเงินได้{" "}
          <Link href="/account/verification" className="underline">
            ยืนยันตัวตน
          </Link>
        </p>
      )}

      {showRecipient && account ? <RecipientStatus account={account} /> : null}

      {account && !account.nameMatchesKyc && hasKycName ? (
        <p className="rounded-lg border border-warning/35 bg-warning/8 px-4 py-3 text-sm text-warning">
          <strong>{account.accountName}</strong> ไม่ตรงกับชื่อที่ยืนยันตัวตน —
          ทีมงานจะตรวจสอบก่อนโอน
        </p>
      ) : null}

      <div className="rounded-xl bg-white p-4 sm:p-6">
        <BankAccountForm
          initial={
            editable
              ? {
                  bankCode: account?.bankCode ?? "",
                  accountNumber: account?.accountNumber ?? "",
                  accountName: account?.accountName ?? "",
                }
              : { bankCode: "", accountNumber: "", accountName: "" }
          }
          masked={
            account ? maskBankAccount(account.bankCode, account.accountNumber) : null
          }
          unlocked={unlocked}
          hasVerifiedPhone={verifiedPhoneCount > 0}
        />
      </div>

      {/* Shown to the seller, not only kept for staff: someone who did not
          make this change is the person best placed to notice it. */}
      {lastChange ? (
        <p className="text-sm text-ink/55">
          เปลี่ยนล่าสุด{" "}
          {lastChange.changedAt.toLocaleString("th-TH", {
            dateStyle: "long",
            timeStyle: "short",
            timeZone: "Asia/Bangkok",
          })}
        </p>
      ) : null}
    </main>
  );
}

/**
 * Whether this account can receive money yet.
 *
 * A status, in the voice the rest of the app uses for statuses: what is true,
 * and — only where the seller has something to do — what to do. The reason
 * Omise checks accounts at all is policy and lives at /privacy; it is not
 * repeated here.
 *
 * "กำลังตรวจสอบ" covers both "we have not managed to register it yet" and
 * "Omise is still deciding", because the seller's position is identical in
 * either case: nothing to do, and the money is not lost.
 */
function RecipientStatus({
  account,
}: {
  account: { recipientStatus: string; omiseRecipientId: string | null };
}) {
  if (account.recipientStatus === "verified" && account.omiseRecipientId) {
    return (
      <p className="rounded-lg border border-success/35 bg-success/8 px-4 py-3 text-sm text-success">
        พร้อมรับเงิน
      </p>
    );
  }

  if (account.recipientStatus === "failed") {
    return (
      <p className="rounded-lg border border-warning/35 bg-warning/8 px-4 py-3 text-sm text-warning">
        ตรวจสอบไม่ผ่าน — กรุณาตรวจเลขบัญชีและชื่อบัญชีแล้วบันทึกใหม่
      </p>
    );
  }

  return (
    <p className="rounded-lg border border-black/10 px-4 py-3 text-sm text-ink/70">
      กำลังตรวจสอบบัญชี (ปกติ 1-2 วันทำการ)
    </p>
  );
}
