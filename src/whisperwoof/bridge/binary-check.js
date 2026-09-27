/**
 * Binary Check — Auto-detect and download missing whisper-server binary
 *
 * Runs on app startup. If the whisper-server binary is missing, downloads
 * it automatically from GitHub releases with a progress notification.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const debugLogger = require("../../helpers/debugLogger");
const { downloadFile, extractArchive, findFile } = require("../../helpers/downloadUtils");
const {
  parseGithubDigest,
  resolveHttpsRedirect,
  requireHttpsUrl,
  githubTokenAllowed,
} = require("./download-integrity-pure");

const WHISPER_CPP_REPO = "OpenWhispr/whisper.cpp";
const MAX_REDIRECTS = 5;

function getExpectedBinaryPath() {
  const platform = process.platform;
  const arch = process.arch;
  const binaryName = platform === "win32"
    ? `whisper-server-${platform}-${arch}.exe`
    : `whisper-server-${platform}-${arch}`;

  // Check all candidate locations
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "bin", binaryName));
  }
  candidates.push(path.join(__dirname, "..", "..", "..", "resources", "bin", binaryName));

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Return the dev location (where we'd download to)
  return path.join(__dirname, "..", "..", "..", "resources", "bin", binaryName);
}

function isBinaryAvailable() {
  const binaryPath = getExpectedBinaryPath();
  return fs.existsSync(binaryPath);
}

// GitHub API JSON over https only. A GitHub token (for rate limits) is sent
// to api.github.com only — never to wherever a redirect points.
function fetchJSON(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    try {
      requireHttpsUrl(url);
    } catch (err) {
      reject(err);
      return;
    }
    const headers = {
      "User-Agent": "WhisperWoof",
      "Accept": "application/vnd.github.v3+json",
    };
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token && githubTokenAllowed(url)) headers["Authorization"] = `token ${token}`;

    https.get(url, { headers, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error("GitHub API: too many redirects"));
          return;
        }
        let next;
        try {
          next = resolveHttpsRedirect(url, res.headers.location);
        } catch (err) {
          reject(err);
          return;
        }
        fetchJSON(next, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GitHub API returned HTTP ${res.statusCode}`));
        return;
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse JSON: ${e.message}`)); }
      });
      res.on("error", reject);
    })
      .on("error", reject)
      .on("timeout", function onTimeout() {
        this.destroy(new Error("GitHub API request timed out"));
      });
  });
}

async function autoDownloadWhisperServer(onStatus) {
  const platform = process.platform;
  const arch = process.arch;
  const platformArch = `${platform}-${arch}`;

  const zipNames = {
    "darwin-arm64": "whisper-server-darwin-arm64.zip",
    "darwin-x64": "whisper-server-darwin-x64.zip",
    "win32-x64": "whisper-server-win32-x64-cpu.zip",
    "linux-x64": "whisper-server-linux-x64-cpu.zip",
  };

  const binaryNames = {
    "darwin-arm64": "whisper-server-darwin-arm64",
    "darwin-x64": "whisper-server-darwin-x64",
    "win32-x64": "whisper-server-win32-x64-cpu.exe",
    "linux-x64": "whisper-server-linux-x64-cpu",
  };

  const zipName = zipNames[platformArch];
  const extractBinaryName = binaryNames[platformArch];
  if (!zipName) {
    debugLogger.log(`[BinaryCheck] Unsupported platform: ${platformArch}`);
    return false;
  }

  onStatus?.("Finding latest release...");

  let workDir = null;
  try {
    // Fetch latest release
    const release = await fetchJSON(`https://api.github.com/repos/${WHISPER_CPP_REPO}/releases/latest`);
    const asset = release?.assets?.find((a) => a.name === zipName);
    if (!asset) {
      debugLogger.log(`[BinaryCheck] Asset ${zipName} not found in release ${release?.tag_name}`);
      return false;
    }

    // GitHub's SHA-256 of the asset (null for assets from before GitHub
    // recorded digests). The zip is checked before it is extracted, and the
    // binary is only installed from a verified archive.
    const sha256 = parseGithubDigest(asset.digest);
    if (!sha256) {
      debugLogger.log(`[BinaryCheck] ${zipName} has no published SHA-256; integrity unchecked`);
    }

    const binDir = path.join(__dirname, "..", "..", "..", "resources", "bin");
    fs.mkdirSync(binDir, { recursive: true });

    const outputName = platform === "win32"
      ? `whisper-server-${platformArch}.exe`
      : `whisper-server-${platformArch}`;
    const outputPath = path.join(binDir, outputName);

    // A fresh, unguessable work dir for the archive and its contents
    // (swept by cleanupStaleDownloads' "temp-extract-" rule if left behind).
    workDir = fs.mkdtempSync(path.join(binDir, "temp-extract-"));
    const zipPath = path.join(workDir, zipName);
    const extractDir = path.join(workDir, "extract");

    // Download (https only, every redirect too; SHA-256 checked when known)
    onStatus?.("Downloading whisper-server...");
    await downloadFile(asset.browser_download_url, zipPath, {
      expectedSize: asset.size,
      sha256,
      onProgress: (downloaded, total) => {
        if (!total) return;
        const pct = Math.round((downloaded / total) * 100);
        onStatus?.(`Downloading whisper-server... ${pct}%`);
      },
    });

    // Extract: execFile with an argv (no shell), JS fallback, Windows aware
    onStatus?.("Extracting...");
    fs.mkdirSync(extractDir);
    await extractArchive(zipPath, extractDir);

    const binaryPath = await findFile(extractDir, extractBinaryName);
    if (!binaryPath) {
      debugLogger.log(`[BinaryCheck] Binary not found in archive`);
      return false;
    }
    fs.copyFileSync(binaryPath, outputPath);
    if (platform !== "win32") fs.chmodSync(outputPath, 0o755);
    debugLogger.log(`[BinaryCheck] whisper-server downloaded to ${outputPath}`);

    onStatus?.("Ready!");
    return true;

  } catch (error) {
    debugLogger.log(`[BinaryCheck] Download failed: ${error.message}`);
    onStatus?.(`Download failed: ${error.message}`);
    return false;
  } finally {
    if (workDir) {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* */ }
    }
  }
}

module.exports = {
  isBinaryAvailable,
  autoDownloadWhisperServer,
};
