import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the public Vercel site as the single browser origin while sending
  // every API request to the stateful Railway app. This keeps wallet sessions,
  // database writes, season ticks, and award verification on the same backend.
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: "https://pump-fantasy-pf-production.up.railway.app/api/:path*",
        },
      ],
    };
  },
};

export default nextConfig;
