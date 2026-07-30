import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import DataProvider from "@/components/DataProvider";
import AuthProvider from "@/components/AuthProvider";
import BottomNav from "@/components/BottomNav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RBANWO Scheduling",
  description: "Renewal by Andersen NWO — Scheduling Workspace",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Scheduling",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1a73e8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="h-full flex flex-col">
        <AuthProvider>
          <DataProvider>
            <main className="flex-1 flex flex-col overflow-hidden">
              {children}
            </main>
            <BottomNav />
          </DataProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
