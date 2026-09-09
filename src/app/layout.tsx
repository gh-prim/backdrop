import type { Metadata } from "next";
import { Lato } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const lato = Lato({
  variable: "--font-lato",
  subsets: ["latin"],
  weight: ["300", "400", "700", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Backdrop",
  description: "Multi-persona operations for Instagram, Telegram and Fanvue.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Dark mode uniquement (spec 6.1). La classe est posée sur <html> pour
  // laisser la porte ouverte à un thème clair plus tard, sans refonte.
  return (
    <html lang="en" className="dark">
      <body className={`${lato.variable} font-sans antialiased`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
