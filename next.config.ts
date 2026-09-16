import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  serverExternalPackages: ["unpdf"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
