import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DialogHost } from "./Dialog";

export const metadata: Metadata = { title: "Robo de Sinais", description: "Sinais da estrategia diaria BTC/ETH/SOL" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}<DialogHost /></body>
    </html>
  );
}
