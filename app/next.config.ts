import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build standalone: a imagem Docker final fica em ~150MB em vez de ~1GB
  output: "standalone",
  reactStrictMode: true,
};

export default nextConfig;
