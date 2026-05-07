import type { NextConfig } from "next";
import { allowedDevOriginsFromEnv } from "./src/lib/dev-origins";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: allowedDevOriginsFromEnv(),
  // Allow `NEXT_DIST_DIR` to override the build output directory so a demo
  // server (e.g. `npm run screenshots`) can run alongside an existing
  // `next dev` without fighting over `.next/`.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  async redirects() {
    return [
      { source: "/xp", destination: "/history", permanent: true },
    ];
  },
};

export default nextConfig;
