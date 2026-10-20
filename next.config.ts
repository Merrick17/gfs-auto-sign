import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // QA builds can write elsewhere so they don't collide with a running `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
