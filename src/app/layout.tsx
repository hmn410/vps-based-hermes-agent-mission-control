import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, VT323, Share_Tech_Mono } from "next/font/google";
import "./globals.css";
import { ConditionalLayout } from "@/components/conditional-layout";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
// JoshBuilds.Tech-matching type: VT323 for big glowing display headings,
// Share Tech Mono for terminal-style UI labels/nav.
const vt323 = VT323({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const shareTechMono = Share_Tech_Mono({ subsets: ["latin"], weight: "400", variable: "--font-terminal" });

export const metadata: Metadata = {
  title: "Hermy HQ",
  description: "Your command center",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" dir="ltr" className="dark">
      <body className={`${geist.variable} ${geistMono.variable} ${vt323.variable} ${shareTechMono.variable} ${geist.className} bg-[#080808] text-white min-h-screen`}>
        <ConditionalLayout>{children}</ConditionalLayout>
      </body>
    </html>
  );
}
