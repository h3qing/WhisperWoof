#!/usr/bin/env node

/**
 * Architecture check — runs during npm install to warn about mismatches.
 *
 * If Node.js is running as x86_64 on an Apple Silicon Mac, native modules
 * (better-sqlite3) will be compiled for the wrong architecture and the
 * app will crash on launch.
 */

const os = require("os");

if (process.platform === "darwin" && os.arch() === "arm64" && process.arch === "x64") {
  console.error("\n");
  console.error("  ⚠️  ARCHITECTURE MISMATCH DETECTED");
  console.error("  ══════════════════════════════════════════════════════");
  console.error("  Your Mac has an Apple M chip (arm64), but Node.js");
  console.error("  is running as Intel (x86_64) via Rosetta.");
  console.error("");
  console.error("  WhisperWoof will CRASH on launch if you continue.");
  console.error("");
  console.error("  Fix: Install the ARM64 version of Node.js:");
  console.error("    • From nodejs.org — choose 'macOS ARM64'");
  console.error("    • Or: brew install node (if Homebrew is arm64)");
  console.error("");
  console.error("  To check: node -e \"console.log(process.arch)\"");
  console.error("  Should print: arm64 (currently prints: x64)");
  console.error("  ══════════════════════════════════════════════════════\n");
  process.exit(1);
}

// Also check the simpler case: running on Apple Silicon natively
if (process.platform === "darwin" && process.arch === "x64") {
  // Could be Intel Mac (fine) or Rosetta (bad).
  // os.cpus()[0].model can help distinguish
  const cpu = os.cpus()[0]?.model || "";
  if (cpu.includes("Apple")) {
    console.error("\n");
    console.error("  ⚠️  ARCHITECTURE MISMATCH DETECTED");
    console.error("  Your Mac has an Apple chip, but Node.js is x86_64.");
    console.error("  Install ARM64 Node.js from nodejs.org to fix this.");
    console.error("\n");
    process.exit(1);
  }
}
