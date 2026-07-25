// Spline 3D scene as the hero backdrop (Lakhdar's request). Loads client-side
// only, fades in when ready, and disappears silently on failure so the landing
// never depends on prod.spline.design being reachable.

"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const Spline = dynamic(() => import("@splinetool/react-spline"), {
  ssr: false,
  loading: () => null,
});

const SCENE_URL =
  "https://prod.spline.design/PT7EoSDKYkLtNYMb/scene.splinecode";

export default function SplineHero() {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 transition-opacity duration-1000"
      style={{ opacity: ready ? 1 : 0 }}
    >
      <Spline
        scene={SCENE_URL}
        onLoad={() => setReady(true)}
        onError={() => setFailed(true)}
        style={{ width: "100%", height: "100%" }}
      />
      {/* legibility gradient so the hero copy stays readable over the scene */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to right, rgba(10,12,16,0.88) 0%, rgba(10,12,16,0.55) 45%, rgba(10,12,16,0.25) 100%)",
        }}
      />
    </div>
  );
}
