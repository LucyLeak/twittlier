import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/app/components/ThemeProvider";
import MobileNav from "@/app/components/MobileNav";
import { getThemeInitScript } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Twittlier",
  description: "Rede social privada estilo anos 90"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Script id="theme-init" strategy="beforeInteractive">
          {getThemeInitScript()}
        </Script>
        <ThemeProvider>
          {children}
          <MobileNav />
        </ThemeProvider>
      </body>
    </html>
  );
}
