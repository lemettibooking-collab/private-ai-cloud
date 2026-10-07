import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { getI18n } from "@/lib/i18n/locale.server";
import "./globals.css";

// AI-038.6: Cyrillic subsets for the Russian UI (same families; no new font dependency).
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "cyrillic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "cyrillic"],
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: "Private AI Cloud",
    description: t.meta.description,
  };
}

// `lang` follows the Owner's interface-language preference (default "ru"); it is presentation only.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale } = await getI18n();
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-canvas text-ink">
        {children}
      </body>
    </html>
  );
}
