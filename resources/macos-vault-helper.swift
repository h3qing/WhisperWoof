// macos-vault-helper — Touch ID for WhisperWoof's encryption.
//
// Holds a Secure Enclave P-256 key-agreement key that needs a fingerprint
// every time it's used ([.privateKeyUsage, .biometryCurrentSet]). The private
// key never leaves the Secure Enclave; WhisperWoof stores only its opaque blob
// and wraps the vault's master key to the public half. Unlocking = Touch ID +
// one ECDH inside the enclave. Adding or removing a fingerprint invalidates
// the key (WhisperWoof then turns Touch ID off; turning it back on takes the
// password).
//
// Works without entitlements, so unsigned (ad-hoc) builds can use it; the
// Keychain with a biometry ACL would need keychain-access-groups.
//
// Commands (one JSON object on stdout, errors as {"error": code, "message"}):
//   status               → {"secureEnclave":bool,"biometry":"available"|"notEnrolled"|"lockout"|"unavailable"}
//   create               → {"publicKey":b64 X9.63,"keyBlob":b64}
//   unlock  (stdin JSON {"keyBlob","peer","purpose"})
//                        → {"shared":b64}   or error cancelled|fallback|invalidated|lockout|unavailable|failed
//           "purpose" (unlock|enroll|confirm) picks one of the prompts below;
//           the prompt text never comes from the caller, so another program
//           can't borrow this helper to ask for a fingerprint in its own words.
//   copy    (stdin JSON {"text"}) → {"copied":true}
//           Puts text on the clipboard marked concealed + transient
//           (nspasteboard.org), so clipboard managers don't keep it, and
//           current-host-only, so it doesn't reach other devices through
//           Universal Clipboard.

import AppKit
import CryptoKit
import CryptoTokenKit
import Foundation
import LocalAuthentication
import Security

let touchIdPrompts: [String: String] = [
  "unlock": "unlock your WhisperWoof history and notes",
  "enroll": "turn on Touch ID for WhisperWoof",
  "confirm": "confirm it's you in WhisperWoof",
]

func emit(_ object: [String: Any]) -> Never {
  let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
  exit(object["error"] == nil ? 0 : 1)
}

func fail(_ code: String, _ message: String) -> Never {
  emit(["error": code, "message": message])
}

func biometryState() -> String {
  let context = LAContext()
  var error: NSError?
  if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
    return "available"
  }
  switch error.map({ LAError.Code(rawValue: $0.code) }) ?? nil {
  case .biometryNotEnrolled: return "notEnrolled"
  case .biometryLockout: return "lockout"
  default: return "unavailable"
  }
}

func status() -> Never {
  emit(["secureEnclave": SecureEnclave.isAvailable, "biometry": biometryState()])
}

func create() -> Never {
  guard SecureEnclave.isAvailable else { fail("unavailable", "This Mac has no Secure Enclave") }
  var cfError: Unmanaged<CFError>?
  guard
    let access = SecAccessControlCreateWithFlags(
      nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .biometryCurrentSet], &cfError)
  else {
    fail("failed", "Couldn't create the access rule")
  }
  do {
    let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access)
    emit([
      "publicKey": key.publicKey.x963Representation.base64EncodedString(),
      "keyBlob": key.dataRepresentation.base64EncodedString(),
    ])
  } catch {
    fail("failed", "Couldn't create the Touch ID key: \(error.localizedDescription)")
  }
}

func readInput() -> [String: String] {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: String] else {
    fail("failed", "Bad input")
  }
  return object
}

func authenticate(_ context: LAContext, reason: String) {
  let done = DispatchSemaphore(value: 0)
  var outcome: Error?
  context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, error in
    if !ok { outcome = error ?? LAError(.authenticationFailed) }
    done.signal()
  }
  done.wait()
  guard let error = outcome else { return }
  switch (error as? LAError)?.code {
  case .userCancel, .appCancel, .systemCancel: fail("cancelled", "Touch ID was cancelled")
  case .userFallback: fail("fallback", "Use your password")
  case .biometryLockout: fail("lockout", "Touch ID is locked. Use your password.")
  case .biometryNotEnrolled, .biometryNotAvailable: fail("unavailable", "Touch ID isn't available")
  default: fail("failed", "Touch ID didn't work")
  }
}

// Whether an error means the enclave key itself is gone for good: the
// fingerprints changed since enrollment (biometryCurrentSet), or the key no
// longer exists. Only then does WhisperWoof drop its Touch ID wrap; any other
// failure (a bad blob or peer, a busy enclave) is reported as plain "failed".
func keyIsGone(_ error: Error) -> Bool {
  let nsError = error as NSError
  if nsError.domain == TKErrorDomain {
    let gone: [TKError.Code] = [.objectNotFound, .tokenNotFound, .corruptedData]
    return gone.map({ $0.rawValue }).contains(nsError.code)
  }
  if nsError.domain == NSOSStatusErrorDomain {
    return nsError.code == Int(errSecItemNotFound)
  }
  if nsError.domain == LAErrorDomain {
    return nsError.code == LAError.Code.biometryNotEnrolled.rawValue
  }
  return false
}

func failKeyUse(_ error: Error) -> Never {
  if keyIsGone(error) { fail("invalidated", "Touch ID needs to be set up again") }
  fail("failed", "Touch ID didn't work")
}

func unlock() -> Never {
  let input = readInput()
  guard
    let blob = input["keyBlob"].flatMap({ Data(base64Encoded: $0) }),
    let peerData = input["peer"].flatMap({ Data(base64Encoded: $0) }),
    let peer = try? P256.KeyAgreement.PublicKey(x963Representation: peerData)
  else {
    fail("failed", "Bad input")
  }
  let reason = touchIdPrompts[input["purpose"] ?? "unlock"] ?? touchIdPrompts["unlock"]!
  let context = LAContext()
  context.localizedCancelTitle = "Cancel"
  context.localizedFallbackTitle = "Use Password"
  authenticate(context, reason: reason)

  let key: SecureEnclave.P256.KeyAgreement.PrivateKey
  do {
    key = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: blob, authenticationContext: context)
  } catch {
    failKeyUse(error)
  }
  do {
    let shared = try key.sharedSecretFromKeyAgreement(with: peer)
    let bytes = shared.withUnsafeBytes { Data($0) }
    emit(["shared": bytes.base64EncodedString()])
  } catch {
    failKeyUse(error)
  }
}

func copySecret() -> Never {
  guard let text = readInput()["text"], !text.isEmpty else { fail("failed", "Bad input") }
  let concealed = NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType")
  let transient = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")
  let board = NSPasteboard.general
  // Clears the board; .currentHostOnly keeps the words off Universal Clipboard.
  _ = board.prepareForNewContents(with: .currentHostOnly)
  guard board.setString(text, forType: .string) else { fail("failed", "Couldn't copy") }
  board.setData(Data(), forType: concealed)
  board.setData(Data(), forType: transient)
  emit(["copied": true])
}

switch CommandLine.arguments.dropFirst().first {
case "status": status()
case "create": create()
case "unlock": unlock()
case "copy": copySecret()
default: fail("failed", "usage: macos-vault-helper status|create|unlock|copy")
}
