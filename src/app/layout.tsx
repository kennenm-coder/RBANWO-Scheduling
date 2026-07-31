import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import DataProvider from "@/components/DataProvider";
import AuthProvider from "@/components/AuthProvider";
import BottomNav from "@/components/BottomNav";
import ToastProvider from "@/components/Toast";
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
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Scheduling",
  },
  other: {
    google: "notranslate",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#3B7A33",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      translate="no"
      className={`${geistSans.variable} ${geistMono.variable} h-full notranslate`}
    >
      <body className="h-full flex flex-col">
        <AuthProvider>
          <DataProvider>
            <ToastProvider>
              <main className="flex-1 flex flex-col overflow-hidden">
                {children}
              </main>
              <BottomNav />
            </ToastProvider>
          </DataProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
