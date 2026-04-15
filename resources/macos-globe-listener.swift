import Cocoa
import Darwin

// --- State ---
var fnIsDown = false
var fnComboKeyEmitted = false
var lastModifierFlags: NSEvent.ModifierFlags = []

// Routing keys to consume when Fn is held (configurable via --routing-keys arg)
var routingKeys: Set<String> = ["T", "N", "P"]

let rightModifiers: [(UInt16, NSEvent.ModifierFlags, String)] = [
    (61, .option, "RightOption"),
    (54, .command, "RightCommand"),
    (62, .control, "RightControl"),
    (60, .shift, "RightShift"),
]

let modifierMask: NSEvent.ModifierFlags = [.control, .command, .option, .shift]

let releases: [(NSEvent.ModifierFlags, String)] = [
    (.control, "control"),
    (.command, "command"),
    (.option, "option"),
    (.shift, "shift"),
]

func emit(_ message: String) {
    FileHandle.standardOutput.write((message + "\n").data(using: .utf8)!)
    fflush(stdout)
}

// --- Parse --routing-keys argument ---
func parseRoutingKeys() {
    let args = CommandLine.arguments
    if let idx = args.firstIndex(of: "--routing-keys"), idx + 1 < args.count {
        let keys = args[idx + 1].split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).uppercased() }
        if !keys.isEmpty {
            routingKeys = Set(keys)
        }
    }
}

parseRoutingKeys()

// --- CGEventTap callback ---
// This runs for EVERY keyboard event system-wide. Must be fast.
func eventTapCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {

    // Re-enable if the system disabled our tap (timeout or user input flood)
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let refcon = refcon {
            let tapPtr = refcon.assumingMemoryBound(to: CFMachPort.self)
            CGEvent.tapEnable(tap: tapPtr.pointee, enable: true)
        }
        return Unmanaged.passRetained(event)
    }

    // --- Flags changed (Fn, modifiers) ---
    if type == .flagsChanged {
        let containsFn = event.flags.contains(.maskSecondaryFn)

        if containsFn && !fnIsDown {
            fnIsDown = true
            fnComboKeyEmitted = false
            emit("FN_DOWN")
        } else if !containsFn && fnIsDown {
            fnIsDown = false
            fnComboKeyEmitted = false
            emit("FN_UP")
        }

        // Right-modifier and general modifier tracking via NSEvent (which has the proper ModifierFlags type)
        if let nsEvent = NSEvent(cgEvent: event) {
            let nsFlags = nsEvent.modifierFlags
            let keyCode = nsEvent.keyCode
            for (code, flag, name) in rightModifiers {
                if keyCode == code {
                    emit(nsFlags.contains(flag) ? "RIGHT_MOD_DOWN:\(name)" : "RIGHT_MOD_UP:\(name)")
                    break
                }
            }

            let currentModifiers = nsFlags.intersection(modifierMask)
            if currentModifiers != lastModifierFlags {
                let released = lastModifierFlags.subtracting(currentModifiers)
                for (flag, name) in releases {
                    if released.contains(flag) {
                        emit("MODIFIER_UP:\(name)")
                    }
                }
                lastModifierFlags = currentModifiers
            }
        }

        // Always pass flag changes through (never consume Fn itself)
        return Unmanaged.passRetained(event)
    }

    // --- Key down while Fn is held → consume routing keys ---
    if type == .keyDown && fnIsDown {
        if let nsEvent = NSEvent(cgEvent: event),
           let chars = nsEvent.charactersIgnoringModifiers?.uppercased(),
           routingKeys.contains(chars) {

            // Emit combo key event only once per Fn hold (suppress key repeat noise)
            if !fnComboKeyEmitted {
                fnComboKeyEmitted = true
                emit("FN_KEY:\(chars)")
            }

            // CONSUME — don't pass to focused app (prevents "ttttt" typing)
            return nil
        }
    }

    // --- Key up while Fn is held → consume routing key release ---
    if type == .keyUp && fnIsDown {
        if let nsEvent = NSEvent(cgEvent: event),
           let chars = nsEvent.charactersIgnoringModifiers?.uppercased(),
           routingKeys.contains(chars) {
            // CONSUME the keyUp too (prevents stray character on release)
            return nil
        }
    }

    // Everything else passes through untouched
    return Unmanaged.passRetained(event)
}

// --- Create CGEventTap ---
let eventMask: CGEventMask = (1 << CGEventType.flagsChanged.rawValue)
    | (1 << CGEventType.keyDown.rawValue)
    | (1 << CGEventType.keyUp.rawValue)

// Storage for the tap reference so the callback can re-enable it
let tapStorage = UnsafeMutablePointer<CFMachPort?>.allocate(capacity: 1)
tapStorage.pointee = nil

guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .defaultTap,
    eventsOfInterest: eventMask,
    callback: eventTapCallback,
    userInfo: tapStorage
) else {
    // CGEventTap creation failed — likely missing Accessibility permission.
    // Fall back to the read-only NSEvent monitor (original behavior, no key consumption).
    emit("NO_ACCESSIBILITY")
    FileHandle.standardError.write(
        "CGEventTap unavailable (Accessibility permission not granted). Falling back to read-only monitor.\n"
            .data(using: .utf8)!
    )

    // Fallback: read-only monitors (same as original implementation)
    guard let flagMonitor = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged, handler: { event in
        let flags = event.modifierFlags
        let containsFn = flags.contains(.function)
        if containsFn && !fnIsDown {
            fnIsDown = true
            fnComboKeyEmitted = false
            emit("FN_DOWN")
        } else if !containsFn && fnIsDown {
            fnIsDown = false
            fnComboKeyEmitted = false
            emit("FN_UP")
        }
        let keyCode = event.keyCode
        for (code, flag, name) in rightModifiers {
            if keyCode == code {
                emit(flags.contains(flag) ? "RIGHT_MOD_DOWN:\(name)" : "RIGHT_MOD_UP:\(name)")
                break
            }
        }
        let currentModifiers = flags.intersection(modifierMask)
        if currentModifiers != lastModifierFlags {
            let released = lastModifierFlags.subtracting(currentModifiers)
            for (flag, name) in releases {
                if released.contains(flag) { emit("MODIFIER_UP:\(name)") }
            }
            lastModifierFlags = currentModifiers
        }
    }) else {
        FileHandle.standardError.write("Failed to create event monitor\n".data(using: .utf8)!)
        exit(1)
    }

    let _ = NSEvent.addGlobalMonitorForEvents(matching: .keyDown, handler: { event in
        if fnIsDown && !fnComboKeyEmitted {
            if let chars = event.charactersIgnoringModifiers?.uppercased(), !chars.isEmpty {
                fnComboKeyEmitted = true
                emit("FN_KEY:\(chars)")
            }
        }
    })

    // Run the fallback event loop
    let signalSourceFallback = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
    signal(SIGTERM, SIG_IGN)
    signalSourceFallback.setEventHandler {
        NSEvent.removeMonitor(flagMonitor)
        exit(0)
    }
    signalSourceFallback.resume()

    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.run()
    // unreachable
    exit(0)
}

// CGEventTap created successfully
tapStorage.pointee = tap

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

emit("ROUTING_KEYS:\(routingKeys.sorted().joined(separator: ","))")

// Handle SIGTERM for graceful shutdown
let signalSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
signal(SIGTERM, SIG_IGN)
signalSource.setEventHandler {
    CGEvent.tapEnable(tap: tap, enable: false)
    tapStorage.deallocate()
    exit(0)
}
signalSource.resume()

CFRunLoopRun()
