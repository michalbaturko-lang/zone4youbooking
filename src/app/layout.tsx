import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zone4You Booking",
  description: "Prezentacni booking engine pro Zone4You s mock Luxart adapterem.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );
}
