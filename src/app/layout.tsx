import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  metadataBase: new URL(process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://read-together-delta.vercel.app"),
  title: "Read together", description: "One EPUB. Two readers, each at their own pace.",
  openGraph: { title: "Read together", description: "One EPUB. Two readers, each at their own pace.", url: "/", type: "website", images: [{ url: "/product-preview.png", width: 1200, height: 630, alt: "Read together: one story, two readers" }] },
  twitter: { card: "summary_large_image", title: "Read together", description: "One EPUB. Two readers, each at their own pace.", images: ["/product-preview.png"] },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
