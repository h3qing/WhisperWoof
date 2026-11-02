#!/usr/bin/env node
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  downloadFile,
  extractArchive,
  fetchReleaseByTag,
  findBinaryInDir,
  parseArgs,
  setExecutable,
  cleanupFiles,
} = require("./lib/download-utils");

const LLAMA_CPP_REPO = "ggml-org/llama.cpp";

// Pinned for reproducible builds (LLAMA_CPP_VERSION overrides it). Qwen3-ASR
// needs b9169 or newer (ggml-org/llama.cpp#23073); b9038 decodes it to
// nonsense. See eval/real-dictation/RESULTS.md.
const LLAMA_CPP_VERSION = process.env.LLAMA_CPP_VERSION || "b12032";
// SHA-256 of the pinned release's archives, so a replaced asset is refused.
// With LLAMA_CPP_VERSION set, GitHub's own asset digest is checked instead.
const PINNED_SHA256 = {
  "llama-b12032-bin-macos-arm64.tar.gz": "00468fe833eb000b78a748122f5921b6c7b07dc82331a8d0c68196c69cb26382",
  "llama-b12032-bin-macos-x64.tar.gz": "291d99f3b6f45f67f73afe5381540f29928840a1a14d9c19d6595bd649a035fc",
  "llama-b12032-bin-ubuntu-x64.tar.gz": "9f10432ca3f66ef003a7a540aaffb9da0acadaefd05404521b9ab7a2436af304",
  "llama-b12032-bin-win-cpu-x64.zip": "5296f5d18bb7d422c7c26f4bb9bc796d9d4f41e1312a8c296cff475bdc60d0d4",
};

const BINARIES = {
  "darwin-arm64": {
    platformArch: "darwin-arm64",
    assetPattern: /^llama-.*-bin-macos-arm64\.tar\.gz$/,
    binaryPath: "build/bin/llama-server",
    outputName: "llama-server-darwin-arm64",
    libPattern: "*.dylib",
  },
  "darwin-x64": {
    platformArch: "darwin-x64",
    assetPattern: /^llama-.*-bin-macos-x64\.tar\.gz$/,
    binaryPath: "build/bin/llama-server",
    outputName: "llama-server-darwin-x64",
    libPattern: "*.dylib",
  },
  "win32-x64-cpu": {
    platformArch: "win32-x64",
    assetPattern: /^llama-.*-bin-win-cpu-x64\.zip$/,
    binaryPath: "build/bin/llama-server.exe",
    outputName: "llama-server-win32-x64-cpu.exe",
    libPattern: "*.dll",
  },
  "linux-x64-cpu": {
    platformArch: "linux-x64",
    assetPattern: /^llama-.*-bin-ubuntu-x64\.tar\.gz$/,
    binaryPath: "build/bin/llama-server",
    outputName: "llama-server-linux-x64-cpu",
    libPattern: "*.so*",
  },
};

const BIN_DIR = path.join(__dirname, "..", "resources", "bin");

let cachedRelease = null;

async function getRelease() {
  if (cachedRelease) return cachedRelease;
  cachedRelease = await fetchReleaseByTag(LLAMA_CPP_REPO, LLAMA_CPP_VERSION);
  return cachedRelease;
}

function findAsset(release, pattern) {
  return release?.assets?.find((a) => pattern.test(a.name));
}

function verifyArchive(archivePath, asset) {
  const expected = PINNED_SHA256[asset.name] || asset.digest?.replace(/^sha256:/, "");
  if (!expected) throw new Error(`no SHA-256 to check ${asset.name} against`);
  const actual = crypto.createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${asset.name}: got ${actual}`);
}

function findLibrariesInDir(dir, pattern, maxDepth = 5, currentDepth = 0) {
  if (currentDepth >= maxDepth) return [];

  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...findLibrariesInDir(fullPath, pattern, maxDepth, currentDepth + 1));
    } else if (matchesPattern(entry.name, pattern)) {
      results.push(fullPath);
    }
  }

  return results;
}

function matchesPattern(filename, pattern) {
  if (pattern === "*.dylib") {
    return filename.endsWith(".dylib");
  } else if (pattern === "*.dll") {
    return filename.endsWith(".dll");
  } else if (pattern === "*.so*") {
    return /\.so(\.\d+)*$/.test(filename) || filename.endsWith(".so");
  }
  return false;
}

// The marker says which release the binary and its libraries came from, so a
// version bump replaces an older install instead of keeping it.
function readInstallMarker(markerPath) {
  try {
    return JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch {
    return null;
  }
}

function isCurrentInstall(marker, outputPath) {
  return (
    fs.existsSync(outputPath) &&
    marker?.version === LLAMA_CPP_VERSION &&
    Array.isArray(marker.libraries) &&
    marker.libraries.every((lib) => fs.existsSync(path.join(BIN_DIR, lib)))
  );
}

// Libraries of the previous install that the new one doesn't ship. Installs
// from before the marker only leave versioned macOS copies behind
// (libllama.0.0.9038.dylib, libggml.0.11.0.dylib and the like).
function removeStaleLibraries(previousMarker, keep) {
  const stale = previousMarker?.libraries
    ? previousMarker.libraries
    : fs
        .readdirSync(BIN_DIR)
        .filter((f) => /^lib(?:llama|llama-common|mtmd|ggml(?:-[a-z]+)?)\.\d+\.\d+\.\d+\.dylib$/.test(f));
  for (const lib of stale) {
    if (keep.includes(lib)) continue;
    fs.rmSync(path.join(BIN_DIR, lib), { force: true });
    console.log(`  Removed stale library ${lib}`);
  }
}

async function downloadBinary(key, config, release, isForce = false) {
  if (!config) {
    console.log(`  ${key}: Not supported`);
    return false;
  }

  const outputPath = path.join(BIN_DIR, config.outputName);
  const markerPath = path.join(BIN_DIR, `.llama-server-${key}.json`);
  const previousMarker = readInstallMarker(markerPath);

  if (!isForce && isCurrentInstall(previousMarker, outputPath)) {
    console.log(`  ${key}: Already exists (use --force to re-download)`);
    return true;
  }

  const asset = findAsset(release, config.assetPattern);
  if (!asset) {
    console.error(`  ${key}: No matching asset found for pattern ${config.assetPattern}`);
    return false;
  }

  console.log(`  ${key}: Downloading from ${asset.url}`);

  const zipPath = path.join(BIN_DIR, asset.name);

  try {
    await downloadFile(asset.url, zipPath);
    verifyArchive(zipPath, asset);

    const extractDir = path.join(BIN_DIR, `temp-llama-${key}`);
    fs.mkdirSync(extractDir, { recursive: true });
    await extractArchive(zipPath, extractDir);

    const binaryName = path.basename(config.binaryPath);
    let binaryPath = path.join(extractDir, config.binaryPath);

    if (!fs.existsSync(binaryPath)) {
      binaryPath = findBinaryInDir(extractDir, binaryName);
    }

    if (binaryPath && fs.existsSync(binaryPath)) {
      fs.copyFileSync(binaryPath, outputPath);
      setExecutable(outputPath);
      console.log(`  ${key}: Extracted to ${config.outputName}`);

      const copiedLibraries = [];
      if (config.libPattern) {
        const libraries = findLibrariesInDir(extractDir, config.libPattern);

        for (const libPath of libraries) {
          const libName = path.basename(libPath);
          const destPath = path.join(BIN_DIR, libName);

          // rm first: copying onto an existing symlink would write through it
          fs.rmSync(destPath, { force: true });
          fs.copyFileSync(libPath, destPath);
          setExecutable(destPath);
          copiedLibraries.push(libName);
          console.log(`  ${key}: Copied library ${libName}`);
        }
      }
      removeStaleLibraries(previousMarker, copiedLibraries);
      fs.writeFileSync(
        markerPath,
        JSON.stringify({ version: release.tag, libraries: copiedLibraries })
      );
    } else {
      console.error(`  ${key}: Binary '${binaryName}' not found in archive`);
      return false;
    }

    fs.rmSync(extractDir, { recursive: true, force: true });
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    return true;
  } catch (error) {
    console.error(`  ${key}: Failed - ${error.message}`);
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    return false;
  }
}

function getEntriesForPlatformArch(platformArch) {
  return Object.entries(BINARIES).filter(([, config]) => config.platformArch === platformArch);
}

async function main() {
  console.log(`\n[llama-server] Using pinned version: ${LLAMA_CPP_VERSION}`);
  const release = await getRelease();

  if (!release) {
    console.error(`[llama-server] Could not fetch release from ${LLAMA_CPP_REPO}`);
    console.log(`\nMake sure release exists: https://github.com/${LLAMA_CPP_REPO}/releases`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nDownloading llama-server binaries (${release.tag})...\n`);

  fs.mkdirSync(BIN_DIR, { recursive: true });

  const args = parseArgs();

  if (args.isCurrent) {
    const entries = getEntriesForPlatformArch(args.platformArch);

    if (entries.length === 0) {
      console.error(`Unsupported platform/arch: ${args.platformArch}`);
      process.exitCode = 1;
      return;
    }

    console.log(`Downloading for target platform (${args.platformArch}):`);

    for (const [key, config] of entries) {
      const ok = await downloadBinary(key, config, release, args.isForce);
      if (!ok && config.optional) {
        console.warn(`  ${key}: Skipping optional variant`);
      } else if (!ok) {
        console.error(`Failed to download binaries for ${key}`);
        process.exitCode = 1;
        return;
      }
    }

    if (args.shouldCleanup) {
      cleanupFiles(BIN_DIR, "llama-server", `llama-server-${args.platformArch}`);
    }
  } else {
    console.log("Downloading binaries for all platforms:");
    for (const [key, config] of Object.entries(BINARIES)) {
      const ok = await downloadBinary(key, config, release, args.isForce);
      if (!ok && config.optional) {
        console.warn(`  ${key}: Skipping optional variant`);
      }
    }
  }

  console.log("\n---");

  const files = fs.readdirSync(BIN_DIR).filter((f) => f.startsWith("llama-server"));
  if (files.length > 0) {
    console.log("Available llama-server binaries:\n");
    files.forEach((f) => {
      const stats = fs.statSync(path.join(BIN_DIR, f));
      console.log(`  - ${f} (${Math.round(stats.size / 1024 / 1024)}MB)`);
    });
  } else {
    console.log("No binaries downloaded yet.");
    console.log(`\nMake sure release exists: https://github.com/${LLAMA_CPP_REPO}/releases`);
  }
}

main().catch(console.error);
