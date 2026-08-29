import Link from "next/link";

import { AvatarUpload } from "@/components/avatar-upload";
import { SignOutButton } from "@/components/sign-out-button";
import { VerificationLevel } from "@/components/verification-level";
import { avatarUrl } from "@/lib/avatar";
import { prisma } from "@/lib/prisma";
import { PushToggle } from "@/components/push-toggle";
import { unreadNotificationCount } from "@/lib/notifications";
import { pushAvailable } from "@/lib/push";
import { requireSession } from "@/lib/session";
import { countStrikes, STRIKE_LIMIT } from "@/lib/strikes";

/**
 * The account page.
 *
 * Grouped by the job you came to do, not by which table the data lives in. The
 * previous version was seven equal cards in one list, so finding "bank account"
 * meant reading all seven; grouping them means reading one heading.
 *
 * Verification level stays at the top and stays alone: it is the only thing
 * here that tells you what you cannot yet do.
 */
export default async function AccountPage() {
  const { user } = await requireSession("/account");
  const unreadNotifications = await unreadNotificationCount(user.id);
  // Read on the SERVER: whether this deployment has VAPID keys decides whether
  // to offer the toggle at all, and a button that cannot work is worse than
  // none.
  const pushEnabled = pushAvailable();

  const [
    profile,
    addressCount,
    credentialAccount,
    verifiedPhoneCount,
    verification,
    strikes,
    bankAccount,
  ] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { avatarKey: true, image: true, name: true, email: true },
    }),
    prisma.shippingAddress.count({ where: { userId: user.id } }),
    prisma.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
      select: { password: true },
    }),
    prisma.verifiedPhone.count({ where: { userId: user.id } }),
    prisma.sellerVerification.findFirst({
      where: { userId: user.id },
      orderBy: { submittedAt: "desc" },
      select: { status: true },
    }),
    countStrikes(user.id),
    prisma.sellerBankAccount.findUnique({
      where: { userId: user.id },
      select: { id: true },
    }),
  ]);

  const hasPassword = Boolean(credentialAccount?.password);

  return (
    <main className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Link
          href="/"
          className="text-sm text-ink/60 underline-offset-4 hover:underline sm:hidden"
        >
          ← กลับหน้าแรก
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">บัญชีของฉัน</h1>
      </div>

      <section className="flex flex-col gap-4 rounded-xl bg-white p-5">
        <AvatarUpload
          src={avatarUrl(profile)}
          name={profile.name}
          hasUpload={profile.avatarKey !== null}
        />
        <div className="flex flex-col gap-0.5 border-t border-black/8 pt-4">
          <p className="font-medium">{profile.name}</p>
          <p className="text-sm text-ink/55">{profile.email}</p>
        </div>
      </section>

      <section className="rounded-xl bg-white p-5">
        <VerificationLevel
          variant="own"
          facts={{
            phoneVerified: verifiedPhoneCount > 0,
            identityVerified: verification?.status === "approved",
          }}
        />
      </section>

      <Group title="การแจ้งเตือน">
        <Row
          href="/account/notifications"
          title="การแจ้งเตือน"
          detail={
            unreadNotifications === 0
              ? "อ่านครบแล้ว"
              : `${unreadNotifications} รายการที่ยังไม่อ่าน`
          }
        />
      </Group>

      {/* Outside the Group list because it is a control, not a link to
          somewhere else — and it belongs next to the page it configures. */}
      {pushEnabled ? (
        <PushToggle publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
      ) : null}

      <Group title="ข้อมูลผู้ขาย">
        <Row
          href="/account/verification"
          title="ยืนยันตัวตนผู้ขาย"
          detail={
            verification?.status === "approved"
              ? "ยืนยันแล้ว"
              : verification?.status === "pending"
                ? "รอทีมงานตรวจสอบ"
                : verification?.status === "rejected"
                  ? "ถูกปฏิเสธ — ส่งใหม่ได้"
                  : "ยังไม่ได้ส่ง"
          }
        />
        <Row
          href="/account/bank"
          title="บัญชีธนาคาร"
          detail={bankAccount ? "บันทึกไว้แล้ว" : "ยังไม่ได้บันทึก"}
        />
        <Row href="/sell" title="รายการขายของฉัน" detail="รายการที่ลงขายไว้" />
      </Group>

      <Group title="ข้อมูลติดต่อและจัดส่ง">
        <Row
          href="/account/phone"
          title="เบอร์โทรศัพท์"
          detail={
            verifiedPhoneCount === 0
              ? "ยังไม่ได้ยืนยัน"
              : `ยืนยันแล้ว ${verifiedPhoneCount} เบอร์`
          }
        />
        <Row
          href="/account/addresses"
          title="ที่อยู่จัดส่ง"
          detail={
            addressCount === 0 ? "ยังไม่มีที่อยู่" : `บันทึกไว้ ${addressCount} ที่อยู่`
          }
        />
      </Group>

      <Group title="การใช้งาน">
        <Row
          href="/account/bids"
          title="ประวัติการประมูล"
          detail={
            strikes > 0
              ? `มีประวัติไม่ชำระเงิน ${strikes}/${STRIKE_LIMIT} ครั้ง`
              : "รายการที่เคยเสนอราคาและชนะ"
          }
        />
      </Group>

      <Group title="ความปลอดภัย">
        <Row
          href="/account/security"
          title="รหัสผ่าน"
          detail={hasPassword ? "ตั้งไว้แล้ว" : "ยังไม่ได้ตั้ง — เข้าสู่ระบบด้วย Google"}
        />
        {/* The label states the fact, the button performs the action. Both
            saying "ออกจากระบบ" made one of them redundant. */}
        <div className="flex items-center justify-between gap-4 px-5 py-3.5">
          <span className="flex flex-col gap-0.5">
            <span className="font-medium">อุปกรณ์นี้</span>
            <span className="text-sm text-ink/55">
              กำลังเข้าสู่ระบบอยู่
            </span>
          </span>
          <SignOutButton />
        </div>
      </Group>

      {/* Last, and deliberately so. The privacy policy used to sit in the
          footer at body size next to the brand, which gave a legal document
          the same weight as the product. It is still in the footer — signed-out
          visitors need a route to it and PDPA expects it to be findable — but
          this is where someone who is looking for it will look. */}
      <Group title="เกี่ยวกับ ThaiAuction">
        <Row
          href="/privacy"
          title="นโยบายความเป็นส่วนตัว"
          detail="ข้อมูลที่เราเก็บ และสิทธิ์ของคุณตาม PDPA"
        />
      </Group>
    </main>
  );
}

/** A titled block of related rows. One card, not one card per link. */
function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-0 overflow-hidden rounded-xl bg-white">
      {/* No `uppercase`: every other heading here is Thai, which the transform
          leaves alone, but it would render the brand as "THAIAUCTION". */}
      <h2 className="px-5 pb-1 pt-4 text-xs font-semibold tracking-wide text-ink/45">
        {title}
      </h2>
      <div className="flex flex-col divide-y divide-black/[.06]">{children}</div>
    </section>
  );
}

function Row({
  href,
  title,
  detail,
}: {
  href: string;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-brand/[.04]"
    >
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-sm text-ink/55">{detail}</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-ink/35">
        →
      </span>
    </Link>
  );
}
