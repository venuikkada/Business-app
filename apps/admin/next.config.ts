import type { NextConfig } from "next";

/**
 * The super-admin panel is a separate deployment (own domain, own cookies).
 * Put it behind an IP allow-list or VPN in production as an extra layer.
 */
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@cba/core", "@cba/server", "@cba/ui"],
  serverExternalPackages: ["pg", "pdfkit", "qrcode", "jszip"],
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'self'" },
        ],
      },
    ];
  },
};
export default config;
