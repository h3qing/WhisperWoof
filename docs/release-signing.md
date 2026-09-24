# Signed releases (Developer ID + notarization)

Releases are built unsigned until five repository secrets exist. Once they do,
`.github/workflows/release.yml` signs the app with your Developer ID and has
Apple notarize it. Nothing else needs to change. The notarization settings are
already in `electron-builder.json`: hardened runtime, entitlements and
`notarize: true`.

**What changes for people installing WhisperWoof:**

- **Opening the app:** download the `.dmg`, drag it into Applications, and it
  opens. There's no "can't verify" warning and no trip to Privacy & Security.
- **Updates:** the app downloads and installs them itself. Squirrel refuses
  unsigned builds, which is why unsigned releases only link to the release
  page.
- **Accessibility:** the grant survives updates. macOS ties it to your Team ID,
  not to one build, so the remove-and-add-back step is gone.

## One-time setup (about 30 minutes, plus Apple's approval time)

1. **Join the Apple Developer Program.** Enroll as an individual at
   https://developer.apple.com/programs/ ($99/year). Approval usually takes
   from a few hours to two days.

2. **Create a "Developer ID Application" certificate.** The easiest way is
   Xcode:
   - Open **Xcode → Settings → Accounts**.
   - Sign in with your Apple ID, then select your team and click
     **Manage Certificates…**.
   - Click **+** and choose **Developer ID Application**.

3. **Export it as a .p12 file.**
   - Open **Keychain Access → login → My Certificates**.
   - Right-click **Developer ID Application: <your name> (<TEAM ID>)** and
     choose **Export…**.
   - Save it as `WhisperWoof-signing.p12` with a strong password.

4. **Create an app-specific password for notarization.**
   - Go to https://account.apple.com → **Sign-In and Security** →
     **App-Specific Passwords**, and click **+**.
   - Name it `WhisperWoof notarize`.

5. **Find your Team ID.** It's on https://developer.apple.com/account under
   **Membership details**. It's 10 characters, like `AB12CDE3FG`.

6. **Add the five secrets to the repository.** Run these from the repo:

   ```bash
   gh secret set CSC_LINK --repo h3qing/WhisperWoof < <(base64 -i WhisperWoof-signing.p12)
   ```

   ```bash
   gh secret set CSC_KEY_PASSWORD --repo h3qing/WhisperWoof
   ```

   ```bash
   gh secret set APPLE_ID --repo h3qing/WhisperWoof
   ```

   ```bash
   gh secret set APPLE_APP_SPECIFIC_PASSWORD --repo h3qing/WhisperWoof
   ```

   ```bash
   gh secret set APPLE_TEAM_ID --repo h3qing/WhisperWoof
   ```

   Each `gh secret set` without input asks for the value. `APPLE_ID` is the
   email of your developer account.

7. **Delete the local .p12** once the secret is stored (or keep it somewhere
   safe, like a password manager). Never commit it.

## Checking it worked

The next release says **"Build macOS arm64 (signed + notarized)"** in the
Actions log, and its release notes read "Updates install from inside the app."
After downloading the `.dmg`, you can confirm it locally:

```bash
spctl -a -vv /Applications/WhisperWoof.app
```

It should print `accepted` and `source=Notarized Developer ID`.

**One Accessibility re-grant.** People moving from an unsigned build to the
first signed one re-grant Accessibility once, because the identity changes from
ad-hoc to your Team ID. After that, the grant survives every update.

**If notarization fails on the first try,** read the error in the Actions log.
The usual cause is a bundled helper binary that needs the hardened-runtime
entitlements. `resources/mac/entitlements.mac.plist` already allows JIT,
unsigned executable memory and disabled library validation for the bundled
llama.cpp and sherpa-onnx servers.
