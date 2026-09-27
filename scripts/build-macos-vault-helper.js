#!/usr/bin/env node

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const isMac = process.platform === "darwin";
if (!isMac) {
  process.exit(0);
}

// Support cross-compilation via --arch flag or TARGET_ARCH env var
const archIndex = process.argv.indexOf("--arch");
const targetArch =
  (archIndex !== -1 && process.argv[archIndex + 1]) || process.env.TARGET_ARCH || process.arch;

const ARCH_TO_TARGET = {
  arm64: "arm64-apple-macosx11.0",
  x64: "x86_64-apple-macosx10.15",
};
const swiftTarget = ARCH_TO_TARGET[targetArch];
if (!swiftTarget) {
  console.error(`[vault-helper] Unsupported architecture: ${targetArch}`);
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, "..");
const swiftSource = path.join(projectRoot, "resources", "macos-vault-helper.swift");
const outputDir = path.join(projectRoot, "resources", "bin");
// macOS titles the Touch ID prompt with the calling app's name and shows its
// icon, so the helper is built as a small app bundle, WhisperWoof.app, with
// WhisperWoof's icon: "WhisperWoof is trying to unlock your history and notes."
const bundleDir = path.join(outputDir, "WhisperWoof.app");
const outputBinary = path.join(bundleDir, "Contents", "MacOS", "WhisperWoof");
const infoPlistPath = path.join(bundleDir, "Contents", "Info.plist");
const iconSource = path.join(projectRoot, "src", "assets", "icon.icns");
const iconDest = path.join(bundleDir, "Contents", "Resources", "icon.icns");
const hashFile = path.join(outputDir, `.macos-vault-helper.${targetArch}.hash`);
const appVersion = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")).version;

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>WhisperWoof</string>
  <key>CFBundleIdentifier</key><string>com.whisperwoof.app.touchid</string>
  <key>CFBundleName</key><string>WhisperWoof</string>
  <key>CFBundleDisplayName</key><string>WhisperWoof</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${appVersion}</string>
  <key>CFBundleVersion</key><string>${appVersion}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`;

/** What the bundle is built from: a change to any of it means a rebuild. */
function inputsHash() {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(swiftSource))
    .update(fs.readFileSync(iconSource))
    .update(INFO_PLIST)
    .digest("hex");
}
const moduleCacheDir = path.join(outputDir, ".swift-module-cache");

// Mach-O CPU type constants for architecture verification
const ARCH_CPU_TYPE = {
  arm64: 0x0100000c, // CPU_TYPE_ARM64
  x64: 0x01000007, // CPU_TYPE_X86_64
};

function log(message) {
  console.log(`[vault-helper] ${message}`);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function verifyBinaryArch(binaryPath, expectedArch) {
  try {
    const fd = fs.openSync(binaryPath, "r");
    const header = Buffer.alloc(8);
    fs.readSync(fd, header, 0, 8, 0);
    fs.closeSync(fd);

    const magic = header.readUInt32LE(0);
    if (magic !== 0xfeedfacf) {
      // Not a 64-bit Mach-O
      return false;
    }
    const cpuType = header.readInt32LE(4);
    const expectedCpu = ARCH_CPU_TYPE[expectedArch];
    return cpuType === expectedCpu;
  } catch {
    return false;
  }
}

if (!fs.existsSync(swiftSource)) {
  console.error(`[vault-helper] Swift source not found at ${swiftSource}`);
  process.exit(1);
}

ensureDir(outputDir);
ensureDir(moduleCacheDir);
ensureDir(path.dirname(outputBinary));
ensureDir(path.dirname(iconDest));

let needsBuild = true;
if (fs.existsSync(outputBinary) && fs.existsSync(infoPlistPath) && fs.existsSync(iconDest)) {
  // Verify existing binary matches the target architecture
  if (!verifyBinaryArch(outputBinary, targetArch)) {
    log(`Existing binary is wrong architecture (expected ${targetArch}), rebuild needed`);
    needsBuild = true;
  } else {
    try {
      const binaryStat = fs.statSync(outputBinary);
      const sourceStat = fs.statSync(swiftSource);
      if (binaryStat.mtimeMs >= sourceStat.mtimeMs) {
        needsBuild = false;
      }
    } catch {
      needsBuild = true;
    }
  }
}

// Secondary check: compare source hash
if (!needsBuild && fs.existsSync(outputBinary)) {
  try {
    const currentHash = inputsHash();

    if (fs.existsSync(hashFile)) {
      const savedHash = fs.readFileSync(hashFile, "utf8").trim();
      if (savedHash !== currentHash) {
        log("Source hash changed, rebuild needed");
        needsBuild = true;
      }
    } else {
      // No hash file for this architecture — force rebuild to ensure correct arch
      log(`No hash file for ${targetArch}, rebuild needed`);
      needsBuild = true;
    }
  } catch (err) {
    log(`Hash check failed: ${err.message}, forcing rebuild`);
    needsBuild = true;
  }
}

if (!needsBuild) {
  process.exit(0);
}

function attemptCompile(command, args) {
  log(`Compiling with ${[command, ...args].join(" ")}`);
  return spawnSync(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      SWIFT_MODULE_CACHE_PATH: moduleCacheDir,
    },
  });
}

const compileArgs = [
  swiftSource,
  "-O",
  "-target",
  swiftTarget,
  "-module-cache-path",
  moduleCacheDir,
  "-o",
  outputBinary,
  "-framework",
  "AppKit",
  "-framework",
  "LocalAuthentication",
  "-framework",
  "Security",
  "-framework",
  "CryptoKit",
  "-framework",
  "Foundation",
];

let result = attemptCompile("xcrun", ["swiftc", ...compileArgs]);

if (result.status !== 0) {
  result = attemptCompile("swiftc", compileArgs);
}

if (result.status !== 0) {
  console.error("[vault-helper] Failed to compile macOS vault helper binary.");
  process.exit(result.status ?? 1);
}

try {
  fs.chmodSync(outputBinary, 0o755);
} catch (error) {
  console.warn(`[vault-helper] Unable to set executable permissions: ${error.message}`);
}

// Verify the compiled binary matches the target architecture
if (!verifyBinaryArch(outputBinary, targetArch)) {
  console.error(
    `[vault-helper] FATAL: Compiled binary architecture does not match target (${targetArch}). ` +
      `This can happen when cross-compiling without setting TARGET_ARCH env var.`
  );
  process.exit(1);
}

// The rest of the app bundle: its Info.plist (name, id, no Dock icon) and icon.
fs.writeFileSync(infoPlistPath, INFO_PLIST);
fs.copyFileSync(iconSource, iconDest);

// Sign the bundle ad hoc so its signature covers the Info.plist and icon (the
// release signs it again along with the rest of the app).
const signed = spawnSync("codesign", ["--force", "--sign", "-", bundleDir], { stdio: "inherit" });
if (signed.status !== 0) {
  log("Warning: couldn't sign WhisperWoof.app ad hoc; the linker's signature on the binary stays");
}

// Save the inputs' hash after a successful build
try {
  fs.writeFileSync(hashFile, inputsHash());
} catch (err) {
  // Non-critical, just log
  log(`Warning: Could not save source hash: ${err.message}`);
}

log(`Successfully built WhisperWoof.app, the macOS vault helper (${targetArch}).`);
