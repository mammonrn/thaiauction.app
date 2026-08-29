import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

import { BottomNav } from "@/components/bottom-nav";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getSession } from "@/lib/session";
import { unpaidWinCount } from "@/lib/unpaid";

/**
 * IBM Plex Sans Thai for everything, IBM Plex Mono for figures. One
 * superfamily drawn to work together, so the two never look bolted on.
 * `display: swap` keeps Thai text readable while the webfont loads.
 */
const plexThai = IBM_Plex_Sans_Thai({
  variable: "--font-plex-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ThaiAuction — ประมูลออนไลน์",
    template: "%s · ThaiAuction",
  },
  description:
    "ประมูลพระเครื่อง ของสะสม และสินค้ามือสองจากผู้ขายที่ยืนยันตัวตนแล้ว",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();
  // One count for the whole app shell. Only for a signed-in visitor: a
  // signed-out one has nothing to owe, and asking would be a query per page
  // view for a guaranteed zero.
  const unpaidWins = session ? await unpaidWinCount(session.user.id) : 0;

  return (
    <html
      lang="th"
      className={`${plexThai.variable} ${plexMono.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        {children}
        <SiteFooter />
        <BottomNav signedIn={session !== null} unpaidWins={unpaidWins} />
      </body>
    </html>
  );
}
