// electron-builder afterPack hook (macOS).
//
// Our builds run with mac.identity=null (no Developer ID), which makes
// electron-builder skip signing entirely. The bundle then keeps Electron's
// stock linker signature ("Electron"), which no longer matches the renamed,
// modified app: `codesign --verify` fails with "code has no resources but
// signature indicates they must be present". macOS cannot tie an Accessibility
// grant to an app whose signature doesn't verify, so the Fn listener could
// never create its event tap and Fn+T/N/P were never seen.
//
// Ad-hoc signing the whole bundle gives it a valid identity
// (com.whisperwoof.app). A real identity, if configured later, re-signs with
// --force after this hook, so this is harmless there.
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log(`  • ad-hoc signed ${path.basename(appPath)} (signature verifies)`);
};
