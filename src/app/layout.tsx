import type { Metadata } from "next";
import "./globals.css";
import { AppProviders } from "./providers";

export const metadata: Metadata = {
  title: "Zone4You rezervace",
  description: "Online rezervační systém Zone4You.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs">
      <body><AppProviders>{children}</AppProviders></body>
    </html>
  );
}
