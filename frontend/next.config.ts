import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The design tokens live at the repo root (design/tokens.css) and are
  // imported by app/globals.css via a relative path that leaves frontend/.
  // Pin the Turbopack root to the repo root so `next dev` can resolve it
  // (otherwise dev panics with "leaves the filesystem root").
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
