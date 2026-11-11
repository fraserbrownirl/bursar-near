import Foundation
import AppKit
import Vision

guard CommandLine.arguments.count > 1 else {
  fputs("usage: ocr.swift <image>\n", stderr)
  exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = NSImage(contentsOf: url) else {
  fputs("unreadable image\n", stderr)
  exit(1)
}
var rect = CGRect(origin: .zero, size: image.size)
guard let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
  fputs("unreadable image\n", stderr)
  exit(1)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
try VNImageRequestHandler(cgImage: cg).perform([request])
let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
print(lines.joined(separator: "\n"))
