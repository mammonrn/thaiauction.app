import Link from "next/link";

import { BankAccountForm } from "@/components/bank-account-form";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { bankName } from "@/lib/thai-banks";

/**
 * Where a seller's share is sent.
 *
 * Only ever the signed-in user's own account: the row is looked up by session
 * user id, and the Server Action writes by the same id, so there is no
 * identifier a visitor could substitute to read or change somebody else's.
 */
export default async function BankAccountPage() {
  const { user } = await requireSession("/account/bank");

  const [account, identity] = await Promise.all([
    prisma.sellerBankAccount.findUnique({
      where: { userId: user.id },
      select: {
        bankCode: true,
        accountNumber: true,
        accountName: true,
        nameMatchesKyc: true,
      },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { firstName: true, lastName: true },
    }),
  ]);

  const hasKycName = Boolean(identity.firstName && identity.lastName);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-6 py-16">
      <Link
        href="/account"
        className="text-sm text-black/60 underline-offset-4 hover:underline dark:text-white/60"
      >
        ← บัญชีของฉัน
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">บัญชีธนาคาร</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          บัญชีที่ทีมงานจะโอนเงินให้เมื่อสินค้าของคุณขายได้และผู้ซื้อชำระเงินแล้ว
          (หักค่าธรรมเนียมระบบชำระเงินและค่าคอมมิชชั่น 10%)
        </p>
      </header>

      {hasKycName ? (
        <p className="rounded-lg border border-black/10 px-4 py-3 text-sm text-black/70 dark:border-white/15 dark:text-white/70">
          ชื่อบัญชีควรตรงกับชื่อที่ยืนยันตัวตนไว้:{" "}
          <strong>
            {identity.firstName} {identity.lastName}
          </strong>
        </p>
      ) : (
        <p className="rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          คุณยังไม่ได้ยืนยันตัวตน — กรอกบัญชีไว้ก่อนได้
          แต่ทีมงานจะโอนเงินให้ก็ต่อเมื่อยืนยันตัวตนผ่านแล้ว{" "}
          <Link href="/account/verification" className="underline">
            ยืนยันตัวตน
          </Link>
        </p>
      )}

      {account && !account.nameMatchesKyc && hasKycName ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          ชื่อบัญชีที่บันทึกไว้ (<strong>{account.accountName}</strong>)
          ไม่ตรงกับชื่อที่ยืนยันตัวตน ทีมงานจะตรวจสอบด้วยตนเองก่อนโอนเงิน
        </p>
      ) : null}

      {account ? (
        <p className="text-sm text-black/60 dark:text-white/60">
          บัญชีปัจจุบัน: {bankName(account.bankCode)} — {account.accountNumber}
        </p>
      ) : null}

      <BankAccountForm
        initial={{
          bankCode: account?.bankCode ?? "",
          accountNumber: account?.accountNumber ?? "",
          accountName: account?.accountName ?? "",
        }}
      />
    </main>
  );
}
