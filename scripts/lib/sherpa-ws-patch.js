/**
 * Build sherpa-onnx's two WebSocket servers from source with WhisperWoof's
 * patch, and put them in place of the prebuilt upstream ones.
 *
 * Why: upstream listens on every network interface (0.0.0.0) with no way to
 * choose loopback, and the offline server copies a client's audio into a
 * buffer sized by a length the client announces, without checking it: one
 * WebSocket message from any device on the same Wi-Fi, or from any web page
 * (browsers may connect to ws://127.0.0.1), overflows the heap. The patch
 * (resources/patches/sherpa-onnx-v<version>-websocket-loopback.patch):
 *   - listens on 127.0.0.1 only,
 *   - refuses handshakes that carry an Origin header (every browser sends
 *     one; the app's Node client never does),
 *   - checks the announced sample rate and size, and every later frame,
 *     against the buffer.
 *
 * Needs git, CMake and a C++ compiler. The build takes a few minutes and is
 * cached in the system temp folder. Set WHISPERWOOF_ALLOW_UNPATCHED_SHERPA=1
 * to keep upstream's servers when building isn't possible (local dev only).
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const SHERPA_REPO = "https://github.com/k2-fsa/sherpa-onnx.git";
const PATCH_DIR = path.join(__dirname, "..", "..", "resources", "patches");
/** A string only the patched offline server contains. */
const PATCH_MARKER = "Payload is larger than announced";
/**
 * The servers use nothing newer than this; the app only runs them where
 * Parakeet is allowed (macOS 15.5+, parakeetCapability.js). Older than the
 * SDK of any current Xcode, so the release runner can build it.
 */
const MACOS_DEPLOYMENT_TARGET = "14.0";

function patchPath(version) {
  return path.join(PATCH_DIR, `sherpa-onnx-v${version}-websocket-loopback.patch`);
}

/** SHA-256 of the patch, recorded in the install marker so a patch change rebuilds. */
function patchDigest(version) {
  return crypto.createHash("sha256").update(fs.readFileSync(patchPath(version))).digest("hex");
}

function allowUnpatched() {
  return process.env.WHISPERWOOF_ALLOW_UNPATCHED_SHERPA === "1";
}

function run(cmd, args, options = {}) {
  execFileSync(cmd, args, { stdio: "inherit", ...options });
}

function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}

function cmakeArgs(platformArch) {
  const args = [
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=ON",
    // Only @loader_path / $ORIGIN: no build-machine path in the binary.
    "-DCMAKE_BUILD_WITH_INSTALL_RPATH=ON",
    "-DSHERPA_ONNX_ENABLE_WEBSOCKET=ON",
    "-DSHERPA_ONNX_ENABLE_BINARY=ON",
    "-DSHERPA_ONNX_ENABLE_C_API=OFF",
    "-DSHERPA_ONNX_ENABLE_TTS=OFF",
    "-DSHERPA_ONNX_ENABLE_SPEAKER_DIARIZATION=OFF",
    "-DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF",
    "-DSHERPA_ONNX_ENABLE_PYTHON=OFF",
    "-DSHERPA_ONNX_ENABLE_TESTS=OFF",
  ];
  if (platformArch.startsWith("darwin")) {
    args.push(`-DCMAKE_OSX_ARCHITECTURES=${platformArch.endsWith("arm64") ? "arm64" : "x86_64"}`);
    args.push(`-DCMAKE_OSX_DEPLOYMENT_TARGET=${MACOS_DEPLOYMENT_TARGET}`);
  }
  // Extra flags, e.g. FETCHCONTENT_SOURCE_DIR_* for machines that can't
  // download the build's dependencies.
  const extra = (process.env.WHISPERWOOF_SHERPA_CMAKE_ARGS || "").trim();
  if (extra) args.push(...extra.split(/\s+/));
  return args;
}

function hostCanBuild(platformArch) {
  const [platform, arch] = platformArch.split("-");
  if (platform !== process.platform) return false;
  // macOS can build either architecture; elsewhere only the host's.
  return platform === "darwin" || arch === process.arch;
}

/**
 * Build the patched servers for `platformArch` and copy them to
 * `outputs.offline` / `outputs.online` (the paths the app runs).
 * `onnxRuntimeDir` is where the prebuilt libonnxruntime was installed; the
 * build must link against the same version. Throws on any failure.
 */
function buildPatchedWebsocketServers({
  version,
  platformArch,
  outputs,
  onnxRuntimeDir,
  finishBinary = () => {},
}) {
  if (!fs.existsSync(patchPath(version))) {
    throw new Error(`No WebSocket server patch for sherpa-onnx v${version}`);
  }
  if (!hostCanBuild(platformArch)) {
    throw new Error(`Can't build sherpa-onnx for ${platformArch} on ${process.platform}-${process.arch}`);
  }

  const workDir = path.join(os.tmpdir(), `whisperwoof-sherpa-onnx-${version}-${platformArch}`);
  const srcDir = path.join(workDir, "src");
  const buildDir = path.join(workDir, "build");
  const digest = patchDigest(version);
  const stampPath = path.join(workDir, "patched.sha256");

  if (!fs.existsSync(stampPath) || fs.readFileSync(stampPath, "utf8") !== digest) {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });
    console.log(`  ${platformArch}: Fetching sherpa-onnx v${version} source`);
    run("git", ["clone", "--quiet", "--depth", "1", "--branch", `v${version}`, SHERPA_REPO, srcDir]);
    run("git", ["apply", "--whitespace=nowarn", patchPath(version)], { cwd: srcDir });
    fs.writeFileSync(stampPath, digest);
  }

  console.log(`  ${platformArch}: Building patched WebSocket servers (a few minutes)`);
  run("cmake", ["-S", srcDir, "-B", buildDir, ...cmakeArgs(platformArch)]);
  run("cmake", [
    "--build",
    buildDir,
    "--config",
    "Release",
    "--parallel",
    String(Math.max(1, os.cpus().length)),
    "--target",
    "sherpa-onnx-offline-websocket-server",
    "sherpa-onnx-online-websocket-server",
  ]);

  // The servers load libonnxruntime from next to themselves: it has to be
  // the exact version the prebuilt archive installed.
  const linked = fs
    .readdirSync(path.join(buildDir, "_deps", "onnxruntime-src", "lib"))
    .filter((name) => /^(lib)?onnxruntime[.\d]*\.(dylib|so[.\d]*|dll)$/.test(name));
  const missing = linked.filter((name) => !fs.existsSync(path.join(onnxRuntimeDir, name)));
  if (linked.length === 0 || missing.length > 0) {
    throw new Error(`ONNX Runtime mismatch: build linked ${linked.join(", ") || "nothing"}`);
  }

  const exe = process.platform === "win32" ? ".exe" : "";
  for (const [target, output] of [
    [`sherpa-onnx-offline-websocket-server${exe}`, outputs.offline],
    [`sherpa-onnx-online-websocket-server${exe}`, outputs.online],
  ]) {
    const built = findFile(path.join(buildDir, "bin"), target);
    if (!built) throw new Error(`Build produced no ${target}`);
    fs.rmSync(output, { force: true });
    fs.copyFileSync(built, output);
    fs.chmodSync(output, 0o755);
    finishBinary(output);
  }

  if (!fs.readFileSync(outputs.offline).includes(PATCH_MARKER)) {
    throw new Error("The built offline server doesn't contain the patch");
  }
  console.log(`  ${platformArch}: Installed patched WebSocket servers`);
  return digest;
}

module.exports = {
  PATCH_MARKER,
  allowUnpatched,
  buildPatchedWebsocketServers,
  cmakeArgs,
  hostCanBuild,
  patchDigest,
  patchPath,
};
