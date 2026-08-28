import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

import { BottomNav } from "@/components/bottom-nav";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getSession } from "@/lib/session";

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
    default: "thaiauction — ประมูลออนไลน์",
    template: "%s · thaiauction",
  },
  description:
    "ประมูลพระเครื่อง ของสะสม และสินค้ามือสองจากผู้ขายที่ยืนยันตัวตนแล้ว",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();

  return (
    <html
      lang="th"
      className={`${plexThai.variable} ${plexMono.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        {children}
        <SiteFooter />
        <BottomNav signedIn={session !== null} />
      </body>
    </html>
  );
}
