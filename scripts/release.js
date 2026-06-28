#!/usr/bin/env node

/**
 * VaultEdge Release Automation Script
 *
 * Usage:
 *   node scripts/release.js <version>   (e.g., node scripts/release.js 1.0.4)
 *   node scripts/release.js patch       (auto-bumps patch version, e.g., 1.0.3 -> 1.0.4)
 *   node scripts/release.js minor       (auto-bumps minor version, e.g., 1.0.3 -> 1.1.0)
 *   node scripts/release.js major       (auto-bumps major version, e.g., 1.0.3 -> 2.0.0)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT_DIR = join(__dirname, "..");

// ─── 1. Get Current Version ──────────────────────────────────────────────────
const rootPkgPath = join(ROOT_DIR, "package.json");
const rootPkg = JSON.parse(readFileSync(rootPkgPath, "utf-8"));
const currentVersion = rootPkg.version;

console.log(`Current version: \x1b[1m${currentVersion}\x1b[0m`);

// ─── 2. Calculate New Version ────────────────────────────────────────────────
let newVersion = process.argv[2];

if (!newVersion) {
  console.error("Error: Please specify a version or bump type (patch, minor, major).");
  console.log("Usage: node scripts/release.js [patch|minor|major|x.y.z]");
  process.exit(1);
}

if (["patch", "minor", "major"].includes(newVersion)) {
  const parts = currentVersion.split(".").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    console.error(`Error: Cannot parse current version "${currentVersion}" for auto-bump.`);
    process.exit(1);
  }

  if (newVersion === "patch") parts[2]++;
  else if (newVersion === "minor") { parts[1]++; parts[2] = 0; }
  else if (newVersion === "major") { parts[0]++; parts[1] = 0; parts[2] = 0; }

  newVersion = parts.join(".");
}

// Validate semver format
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error(`Error: Invalid target version format "${newVersion}". Must be semver (e.g., 1.0.4).`);
  process.exit(1);
}

console.log(`Bumping version: \x1b[32m${currentVersion} ➔ ${newVersion}\x1b[0m\n`);

// Helper to update JSON file version
function updateJsonVersion(filePath, updateFn) {
  const fullPath = join(ROOT_DIR, filePath);
  const data = JSON.parse(readFileSync(fullPath, "utf-8"));
  updateFn(data);
  writeFileSync(fullPath, JSON.stringify(data, null, 2) + "\n");
  console.log(`✓ Updated ${filePath}`);
}

// Helper to update text file version using regex
function updateTextVersion(filePath, regex, replacement) {
  const fullPath = join(ROOT_DIR, filePath);
  const content = readFileSync(fullPath, "utf-8");
  const updated = content.replace(regex, replacement);
  writeFileSync(fullPath, updated);
  console.log(`✓ Updated ${filePath}`);
}

// ─── 3. Update NPM Workspaces & Dependencies ─────────────────────────────────

// Root package.json
updateJsonVersion("package.json", (pkg) => {
  pkg.version = newVersion;
});

// Core package.json
updateJsonVersion("packages/core/package.json", (pkg) => {
  pkg.version = newVersion;
});

// CLI package.json
updateJsonVersion("packages/cli/package.json", (pkg) => {
  pkg.version = newVersion;
  if (pkg.dependencies && pkg.dependencies["@durgadas/vaultedge-core"]) {
    pkg.dependencies["@durgadas/vaultedge-core"] = `^${newVersion}`;
  }
});

// SDK package.json
updateJsonVersion("packages/sdk/package.json", (pkg) => {
  pkg.version = newVersion;
  if (pkg.dependencies && pkg.dependencies["@durgadas/vaultedge-core"]) {
    pkg.dependencies["@durgadas/vaultedge-core"] = `^${newVersion}`;
  }
});

// Proxy package.json
updateJsonVersion("apps/proxy/package.json", (pkg) => {
  pkg.version = newVersion;
  if (pkg.dependencies && pkg.dependencies["@durgadas/vaultedge-core"]) {
    pkg.dependencies["@durgadas/vaultedge-core"] = `^${newVersion}`;
  }
});

// ─── 4. Update Python SDK Metadata ───────────────────────────────────────────

// pyproject.toml
updateTextVersion("sdks/python/pyproject.toml", /version\s*=\s*"[^"]+"/, `version = "${newVersion}"`);

// __init__.py
updateTextVersion("sdks/python/vaultedge/__init__.py", /__version__\s*=\s*"[^"]+"/, `__version__ = "${newVersion}"`);

// ─── 5. Update Code References ────────────────────────────────────────────────

// CLI runtime version command
updateTextVersion("packages/cli/src/index.ts", /\.version\("[^"]+"\)/, `.version("${newVersion}")`);

// Next.js Web UI Shell.tsx footer version
updateTextVersion("apps/web/src/components/layout/Shell.tsx", /v\d+\.\d+\.\d+ · MIT License/, `v${newVersion} · MIT License`);

// ─── 6. Sync Lockfile ────────────────────────────────────────────────────────
console.log("\nSynchronizing package-lock.json...");
try {
  execSync("npm install", { cwd: ROOT_DIR, stdio: "inherit" });
  console.log("✓ Synchronized package-lock.json");
} catch (err) {
  console.error("Warning: Failed to run 'npm install' to sync lockfile.");
}

console.log(`\n\x1b[32m\x1b[1mSuccess! Version bumped to ${newVersion}.\x1b[0m`);
console.log("\nRun the following commands to commit and publish:");
console.log(`  git add .`);
console.log(`  git commit -m "release: v${newVersion}"`);
console.log(`  git push origin main`);
console.log(`  git tag v${newVersion}`);
console.log(`  git push origin v${newVersion}`);
