import CoreImage
import Foundation
import Vision

// Prints the recognized text lines of one image, one per line.
// The text is untrusted: the caller scans it like any pasted block.
guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: ocr <image>\n".utf8))
    exit(2)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let image = CIImage(contentsOf: url) else {
    FileHandle.standardError.write(Data("STOP: image\n".utf8))
    exit(1)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
let handler = VNImageRequestHandler(ciImage: image)
do {
    try handler.perform([request])
    let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    FileHandle.standardOutput.write(Data(lines.joined(separator: "\n").utf8))
} catch {
    FileHandle.standardError.write(Data("STOP: ocr \(error.localizedDescription)\n".utf8))
    exit(1)
}
