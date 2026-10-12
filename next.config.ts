import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // Vercel serves the public UI and forwards API requests to Railway, where
    // the database and season worker live. Do not enable this on Railway or it
    // would proxy the API back to itself.
    if (process.env.PF_API_PROXY !== "1") return [];
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
