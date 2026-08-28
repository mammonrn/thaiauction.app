import Link from "next/link";

import { BID_METADATA_RETENTION_DAYS } from "@/lib/retention";

export const metadata = {
  title: "นโยบายความเป็นส่วนตัว",
};

/**
 * Privacy policy.
 *
 * Written because the marketplace collects IP addresses and User-Agent strings
 * to detect shill bidding, and PDPA requires that collection to be disclosed
 * along with its purpose and how long it is kept. It covers the other personal
 * data the system already held too — telling people about one collection and
 * staying quiet about the rest would be worse than saying nothing.
 *
 * Deliberately plain and specific: a policy that lists what is actually stored
 * is more useful, and easier to keep honest, than one that reserves every
 * right in general terms.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          นโยบายความเป็นส่วนตัว
        </h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          นโยบายนี้อธิบายว่าเราเก็บข้อมูลอะไร เพื่ออะไร และเก็บไว้นานแค่ไหน
        </p>
      </header>

      <Section title="ข้อมูลที่เราเก็บ">
        <List
          items={[
            "ชื่อ อีเมล และรูปโปรไฟล์ จากบัญชี Google ที่คุณใช้เข้าสู่ระบบ",
            "เบอร์โทรศัพท์ที่คุณยืนยันผ่าน SMS",
            "ที่อยู่สำหรับจัดส่งสินค้า",
            "ชื่อ-นามสกุลและวันเกิด สำหรับผู้ที่ต้องการขายสินค้า (ยืนยันตัวตน)",
            "รูปบัตรประชาชน เฉพาะระหว่างรอตรวจสอบการยืนยันตัวตน",
            "ประวัติการเสนอราคา การชนะประมูล และการชำระเงิน",
            "บัญชีธนาคารของผู้ขาย สำหรับโอนเงินค่าสินค้า",
            "หมายเลข IP address และข้อมูลเบราว์เซอร์ (User-Agent) ของทุกการเสนอราคา",
          ]}
        />
      </Section>

      <Section title="ทำไมเราเก็บ IP address">
        <p>
          เราบันทึกหมายเลข IP address และข้อมูลเบราว์เซอร์ของทุกการเสนอราคา
          <strong> เพื่อป้องกันการปั่นราคา (shill bidding)</strong> —
          คือกรณีที่ผู้ขายสร้างบัญชีหลายบัญชีมาเสนอราคาสินค้าของตัวเอง
          เพื่อดันราคาให้สูงขึ้นโดยไม่มีคนซื้อจริง
        </p>
        <p>
          ข้อมูลนี้ใช้เพื่อการตรวจสอบเท่านั้น
          และแสดงให้เฉพาะทีมงานที่ดูแลระบบเห็น
          เราไม่เปิดเผยให้ผู้ใช้รายอื่น ไม่ใช้ทำโฆษณา
          และไม่ส่งต่อให้บุคคลภายนอก
        </p>
        <p>
          ระบบ<strong>ไม่ระงับบัญชีโดยอัตโนมัติ</strong>จากข้อมูลนี้
          เพราะคนในครอบครัวหรือที่ทำงานเดียวกันอาจใช้อินเทอร์เน็ตวงเดียวกันได้
          ทีมงานจะตรวจสอบด้วยตนเองก่อนเสมอ
        </p>
      </Section>

      <Section title="ระยะเวลาที่เก็บ">
        <List
          items={[
            `IP address และ User-Agent: ลบอัตโนมัติหลัง ${BID_METADATA_RETENTION_DAYS} วัน (ประวัติการเสนอราคาเองยังคงอยู่ เพราะเป็นหลักฐานทางการเงิน)`,
            "รูปบัตรประชาชน: ลบทันทีเมื่อทีมงานตรวจสอบเสร็จ ไม่ว่าผลจะผ่านหรือไม่ผ่าน",
            "ชื่อ-นามสกุล วันเกิด และประวัติการซื้อขาย: เก็บตลอดอายุบัญชี เพราะเป็นหลักฐานของรายการที่เกิดขึ้นจริง",
          ]}
        />
      </Section>

      <Section title="ข้อมูลบัตรเครดิต">
        <p>
          เรา<strong>ไม่เก็บและไม่เห็นหมายเลขบัตรเครดิตของคุณ</strong>{" "}
          ข้อมูลบัตรถูกส่งตรงจากเบราว์เซอร์ของคุณไปยัง Omise
          ซึ่งเป็นผู้ให้บริการรับชำระเงินที่ได้มาตรฐาน PCI-DSS
          ระบบของเราได้รับเพียงรหัสอ้างอิงการชำระเงินเท่านั้น
        </p>
      </Section>

      <Section title="สิทธิของคุณ">
        <p>
          คุณมีสิทธิขอเข้าถึง แก้ไข หรือขอให้ลบข้อมูลส่วนบุคคลของคุณ
          ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล (PDPA)
          โดยติดต่อทีมงานได้ตลอดเวลา
          ทั้งนี้ข้อมูลที่เป็นหลักฐานของรายการซื้อขายที่เกิดขึ้นแล้ว
          อาจจำเป็นต้องเก็บไว้ตามที่กฎหมายกำหนด
        </p>
      </Section>

      <Link
        href="/"
        className="text-sm text-black/60 underline-offset-4 hover:underline dark:text-white/60"
      >
        ← กลับหน้าแรก
      </Link>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-black/80 dark:text-white/80">
        {children}
      </div>
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
