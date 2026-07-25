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

  // Ticket #54 — Next's gzip compresses proxied responses and BUFFERS the
  // SSE stream (verified: with Accept-Encoding: gzip only the 10-byte gzip
  // header leaves the proxy, so EventSource never receives an event). The
  // demo runs locally; losing asset gzip is free, a starved live stream is not.
  compress: false,

  // Ticket #54 — same-origin proxy to the FastAPI backend so the live SSE
  // stream and the approval/incident endpoints need no CORS from the browser.
  // BACKEND_URL (server-side env, default local dev port from backend/.env
  // conventions) can point the proxy elsewhere without a code change; the
  // client can also bypass the proxy entirely via NEXT_PUBLIC_BACKEND_URL.
  async rewrites() {
    const backend = process.env.BACKEND_URL ?? "http://localhost:8080";
    return [
      {
        source: "/api/backend/:path*",
        destination: `${backend}/:path*`,
      },
    ];
  },
};

export default nextConfig;
