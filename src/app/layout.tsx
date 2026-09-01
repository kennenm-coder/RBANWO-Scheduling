import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import DataProvider from "@/components/DataProvider";
import AuthProvider from "@/components/AuthProvider";
import RequireAuth from "@/components/RequireAuth";
import BottomNav from "@/components/BottomNav";
import ToastProvider from "@/components/Toast";
import UpdatePrompt from "@/components/UpdatePrompt";
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
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
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
        {/* Apply saved theme before paint to avoid a flash of the wrong theme.
            Mirrors applyTheme() in src/lib/theme.ts. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('rbanwo-sched-theme')||'system';var r=document.documentElement;r.classList.remove('dark','cream');if(t==='dark'){r.classList.add('dark');r.style.colorScheme='dark';}else if(t==='light'){r.style.colorScheme='light';}else if(t==='cream'){r.classList.add('cream');r.style.colorScheme='light';}}catch(e){}})();`,
          }}
        />
        <AuthProvider>
          <RequireAuth>
            <DataProvider>
              <ToastProvider>
                <main className="flex-1 flex flex-col overflow-hidden">
                  {children}
                </main>
                <BottomNav />
                <UpdatePrompt />
              </ToastProvider>
            </DataProvider>
          </RequireAuth>
        </AuthProvider>
      </body>
    </html>
  );
}
