import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  allowedDevOrigins: ["*.e2b.app", "localhost", "127.0.0.1"],
  headers: async () => [
    {
      source: "/vision/:path*",
      headers: [
        { key: "Access-Control-Allow-Origin", value: "*" },
        { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
      ],
    },
    {
      source: "/models/:path*",
      headers: [
        { key: "Access-Control-Allow-Origin", value: "*" },
        { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
      ],
    },
  ],
};

export default nextConfig;
