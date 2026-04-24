import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  async redirects() {
    return [
      { source: "/xp", destination: "/history", permanent: true },
    ];
  },
};

export default nextConfig;
