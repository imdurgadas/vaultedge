import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@vaultedge/core"],
  // Use webpack (not Turbopack) to support yaml-loader
  turbopack: {},
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        fs: false,
        path: false,
      };
    }
    config.module.rules.push({
      test: /\.ya?ml$/,
      use: "yaml-loader",
    });
    return config;
  },
};

export default nextConfig;
