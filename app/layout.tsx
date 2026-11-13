import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { DialogHost } from "./Dialog";

// Fonte do site (baixada no build e servida pelo proprio site)
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-sans" });

export const metadata: Metadata = { title: "SeuBitico", description: "Finanças pessoais e cripto - SeuBitico" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body>{children}<DialogHost /></body>
    </html>
  );
}
