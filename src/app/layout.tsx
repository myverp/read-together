import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Read together", description: "One EPUB. Two readers." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
