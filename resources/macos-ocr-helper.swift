// macos-ocr-helper — reads the words in clipboard images so WhisperWoof's
// Clipboard search can find them.
//
// Uses Apple's Vision text recognition on this Mac: nothing goes over the
// network and there is no model to download. The process puts itself in the
// Darwin background band (throttled CPU, disk and GPU; efficiency cores on
// Apple silicon), so it steps aside for whatever the user is doing.
//
// Protocol: {"ready": true, "languages": […]} once it has started, then one
// JSON line on stdout per image frame on stdin.
//   frame   u32 big-endian byte count, then the image bytes (PNG, JPEG, HEIC, TIFF…)
//   answer  {"text": "first line\nsecond line", "lines": 2}
//           {"error": "unreadable", "message": …}   not an image macOS can open
//           {"error": "failed", "message": …}       recognition failed
// End of input (or a zero-length frame) ends the process. Image bytes never
// touch the disk: WhisperWoof decrypts sealed images in memory and pipes them
// here, and this helper writes no files.
//
// Arguments: --languages zh-Hans,en-US   languages to read, most important first
//            (ones this macOS can't read are dropped; English when none are left)

import CoreGraphics
import Foundation
import ImageIO
import Vision

let maxFrameBytes = 64 * 1024 * 1024
// Longest edge Vision sees. Screenshots are smaller; big photos are scaled
// down first, which keeps memory flat without losing legible text.
let maxEdgePixels = 4096
let maxTextCharacters = 20000

// Background band for the whole process (sys/resource.h: PRIO_DARWIN_PROCESS
// is 4, PRIO_DARWIN_BG is 0x1000).
_ = setpriority(4, 0, 0x1000)

func writeAnswer(_ object: [String: Any]) {
  let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{\"error\":\"failed\"}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
}

func readExactly(_ count: Int) -> Data? {
  var data = Data()
  data.reserveCapacity(count)
  while data.count < count {
    let chunk = FileHandle.standardInput.readData(ofLength: count - data.count)
    if chunk.isEmpty { return nil }
    data.append(chunk)
  }
  return data
}

func readFrame() -> Data? {
  guard let header = readExactly(4) else { return nil }
  let length = header.reduce(0) { (sum: Int, byte: UInt8) in (sum << 8) | Int(byte) }
  guard length > 0, length <= maxFrameBytes else { return nil }
  return readExactly(length)
}

/// The image, upright and at most maxEdgePixels on its longest edge.
func loadImage(_ data: Data) -> CGImage? {
  guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0 else {
    return nil
  }
  let options = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceThumbnailMaxPixelSize: maxEdgePixels,
    kCGImageSourceShouldCacheImmediately: true,
  ] as CFDictionary
  return CGImageSourceCreateThumbnailAtIndex(source, 0, options)
}

func supportedLanguages() -> Set<String> {
  if #available(macOS 12.0, *) {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    if let list = try? request.supportedRecognitionLanguages() { return Set(list) }
  } else if #available(macOS 11.0, *) {
    if let list = try? VNRecognizeTextRequest.supportedRecognitionLanguages(
      for: .accurate, revision: VNRecognizeTextRequestRevision2)
    {
      return Set(list)
    }
  }
  return ["en-US"]
}

func requestedLanguages() -> [String] {
  let args = CommandLine.arguments
  guard let flag = args.firstIndex(of: "--languages"), flag + 1 < args.count else { return [] }
  return args[flag + 1].split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
}

let languages: [String] = {
  let supported = supportedLanguages()
  let chosen = requestedLanguages().filter { supported.contains($0) }
  return chosen.isEmpty ? ["en-US"] : chosen
}()

func recognizedLines(_ image: CGImage, languages: [String]) throws -> [String] {
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.recognitionLanguages = languages
  try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
  let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
  return observations.compactMap { $0.topCandidates(1).first?.string }
}

func recognize(_ image: CGImage) throws -> [String] {
  do {
    return try recognizedLines(image, languages: languages)
  } catch {
    // Some language mixes can't be read together; the first one alone can.
    guard languages.count > 1 else { throw error }
    return try recognizedLines(image, languages: [languages[0]])
  }
}

writeAnswer(["ready": true, "languages": languages])

while let frame = readFrame() {
  autoreleasepool {
    guard let image = loadImage(frame) else {
      writeAnswer(["error": "unreadable", "message": "Not an image macOS can open"])
      return
    }
    do {
      let lines = try recognize(image)
      var text = lines.joined(separator: "\n")
      if text.count > maxTextCharacters { text = String(text.prefix(maxTextCharacters)) }
      writeAnswer(["text": text, "lines": lines.count])
    } catch {
      writeAnswer(["error": "failed", "message": error.localizedDescription])
    }
  }
}
exit(0)
