import "./globals.css";
import type { ReactNode } from "react";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { LoadingProgressBar } from "../components/ui/LoadingProgressBar";
import { ThemeProvider } from "../components/theme-provider";
import { AccentApplier } from "../components/layout/AccentApplier";
import { Toaster } from "../components/ui/shadcn/sonner";

const bodyClassName = `${GeistSans.variable} ${GeistMono.variable} min-h-screen bg-background text-foreground antialiased`;

export const metadata = {
  title: "Vakwen",
  description: "Multi-market portfolio intelligence",
  openGraph: {
    title: "Vakwen",
    description: "Multi-market portfolio intelligence",
    siteName: "Vakwen",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Vakwen",
    description: "Multi-market portfolio intelligence",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={bodyClassName}>
        <ThemeProvider>
          <AccentApplier />
          <LoadingProgressBar />
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
