import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [{ source: "/room/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
  },
};
export default nextConfig;
