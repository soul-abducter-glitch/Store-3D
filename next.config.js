const { withPayload } = require("@payloadcms/next/withPayload");

const isAdminMode =
  process.env.NEXT_PUBLIC_MODE === "admin" ||
  process.env.PORT === "3001" ||
  (process.env.NEXT_PUBLIC_SERVER_URL || "").includes("3001");

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
};

module.exports = isAdminMode ? withPayload(baseConfig) : baseConfig;
