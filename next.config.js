const { withPayload } = require("@payloadcms/next/withPayload");

const isAdminMode = process.env.NEXT_PUBLIC_MODE === "admin";

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

/** @type {import("next").NextConfig} */
const baseConfig = {
  reactStrictMode: true,
  distDir: isAdminMode ? ".next-admin" : ".next-frontend",
  experimental: {
    serverActions: {
      bodySizeLimit: "200mb",
    },
    middlewareClientMaxBodySize: "200mb",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = isAdminMode ? withPayload(baseConfig) : baseConfig;
