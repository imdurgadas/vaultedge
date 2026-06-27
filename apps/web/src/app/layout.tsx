import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VaultEdge — Zero-Trust AI Key Manager",
  description: "Securely manage your AI provider API keys. Encrypt locally, deploy anywhere, fall back automatically.",
  openGraph: {
    title: "VaultEdge",
    description: "Zero-trust AI key manager & smart proxy",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
