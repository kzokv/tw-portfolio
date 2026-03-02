import "./globals.css";
import type { ReactNode } from "react";
import { Plus_Jakarta_Sans, Sora } from "next/font/google";
import { LoadingProgressBar } from "../components/ui/LoadingProgressBar";

const displayFont = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
});

const bodyFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700"],
});

const bodyClassName = `${displayFont.variable} ${bodyFont.variable} min-h-screen bg-bg text-ink antialiased`;

export const metadata = {
  title: "TW Portfolio",
  description: "Taiwan portfolio intelligence dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={bodyClassName}>
        <LoadingProgressBar />
        {children}
      </body>
    </html>
  );
}
