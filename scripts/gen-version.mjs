// Generates public/version.json with a per-deploy version string.
//
// This file is served as a plain static asset by the HOST/CDN (Vercel, etc.) and
// fetched by the in-app update prompt (src/lib/use-update-gate.ts). It does NOT
// touch Supabase, so the update check has zero impact on Supabase egress.
//
// Runs automatically before `dev` and `build` (see the predev/prebuild npm
// scripts). The output is git-ignored — every deploy regenerates it.

import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, "..", "public", "version.json");

function resolveVersion() {
  // Prefer an immutable commit SHA so identical code keeps the same version —
  // rebuilding the same commit must NOT nag users with a bogus update prompt.
  const fromCi =
    process.env.VERCEL_GIT_COMMIT_SHA || // Vercel
    process.env.COMMIT_REF || // Netlify
    process.env.GITHUB_SHA || // GitHub Actions
    process.env.CF_PAGES_COMMIT_SHA; // Cloudflare Pages
  if (fromCi) return fromCi.slice(0, 12);

  try {
    return execSync("git rev-parse --short=12 HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    // No git and no CI env (rare) — fall back to build time. Each build then
    // reads as a new version, which at worst shows one extra (harmless) prompt.
    return `t${Date.now()}`;
  }
}

const version = resolveVersion();
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ version }) + "\n");
console.log(`[gen-version] public/version.json -> ${version}`);
