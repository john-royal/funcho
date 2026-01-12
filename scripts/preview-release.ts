#!/usr/bin/env bun
import { $ } from "bun";

console.log("🔍 Previewing next release...\n");
console.log("Note: Requires GITHUB_TOKEN env var for full preview\n");
console.log(
  "Alternative: Use the GitHub Actions 'dry-run' option for a complete preview\n",
);

// Check if GITHUB_TOKEN exists
if (!process.env.GITHUB_TOKEN) {
  console.error("❌ GITHUB_TOKEN environment variable not set");
  console.error("\nTo preview locally:");
  console.error(
    "  1. Create a GitHub personal access token (classic) with 'repo' scope",
  );
  console.error(
    "  2. Run: GITHUB_TOKEN=your_token bun run scripts/preview-release.ts",
  );
  console.error("\nOr use GitHub Actions:");
  console.error("  1. Go to Actions → Release workflow");
  console.error("  2. Click 'Run workflow'");
  console.error("  3. Check 'Dry run'");
  console.error("  4. View logs to see what would be released");
  process.exit(1);
}

try {
  await $`npx semantic-release --dry-run --no-ci`;
} catch (error) {
  console.error("\n❌ Preview failed. Possible reasons:");
  console.error("  - No commits since last release trigger a version bump");
  console.error("  - Missing semantic-release dependencies (run: bun install)");
  console.error("  - Invalid conventional commits format");
  process.exit(1);
}
