import type { NextConfig } from "next";

const customDistDir = String(process.env.MINDX_NEXT_DIST_DIR || "").trim();
const customTsconfigPath = String(process.env.MINDX_NEXT_TSCONFIG_PATH || "").trim();

const nextConfig: NextConfig = {
  ...(customDistDir ? { distDir: customDistDir } : {}),
  ...(customTsconfigPath ? { typescript: { tsconfigPath: customTsconfigPath } } : {}),
  serverExternalPackages: ["better-sqlite3"],
  devIndicators: false,
};

export default nextConfig;
