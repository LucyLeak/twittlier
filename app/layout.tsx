import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Twittlier",
  description: "Rede social privada estilo anos 90"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
