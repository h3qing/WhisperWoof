// electron-builder afterPack hook.
//
// 1. Electron fuses (every platform). They are flipped here, not with
//    electron-builder's `electronFuses` option, because electron-builder
//    flips those after this hook: that would change the Electron binary
//    after step 2 signed it and break the signature. With these off, another
//    program can't run WhisperWoof's binary as plain Node, feed it
//    NODE_OPTIONS or attach a debugger, and so can't borrow its Accessibility,
//    Microphone or Screen Recording permissions; and only the packaged
//    app.asar (integrity-checked on macOS) is ever loaded.
//
// 2. Ad-hoc signing (macOS). Our builds run with mac.identity=null (no
//    Developer ID), which makes electron-builder skip signing entirely. The
//    bundle then keeps Electron's stock linker signature ("Electron"), which
//    no longer matches the renamed, modified app: `codesign --verify` fails
//    with "code has no resources but signature indicates they must be
//    present". macOS cannot tie an Accessibility grant to an app whose
//    signature doesn't verify, so the Fn listener could never create its
//    event tap and Fn+T/N/P were never seen. Ad-hoc signing the whole bundle
//    gives it a valid identity (com.whisperwoof.app). A real identity, if
//    configured later, re-signs with --force after this hook, so this is
//    harmless there.
const { execFileSync } = require("child_process");
const path = require("path");

// The @electron/fuses electron-builder itself ships with.
function loadFuses() {
  const builderDir = path.dirname(require.resolve("app-builder-lib/package.json"));
  return require(require.resolve("@electron/fuses", { paths: [builderDir] }));
}

function fuseConfig(platform) {
  const { FuseVersion, FuseV1Options } = loadFuses();
  return {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // electron-builder writes the asar hash into Info.plist on macOS only.
    ...(platform === "darwin" && { [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true }),
  };
}

exports.default = async function afterPack(context) {
  await context.packager.addElectronFuses(context, fuseConfig(context.electronPlatformName));
  console.log("  • flipped Electron fuses (no RunAsNode, NODE_OPTIONS or --inspect)");

  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log(`  • ad-hoc signed ${path.basename(appPath)} (signature verifies)`);
};

exports.fuseConfig = fuseConfig;
