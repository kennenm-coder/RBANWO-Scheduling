import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // The update prompt polls this tiny file to detect new deploys. Force it
        // uncached so a stale CDN/browser copy can't hide a fresh version.
        source: "/version.json",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
