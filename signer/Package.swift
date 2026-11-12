// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "bursar-signer",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "bursar-signer",
            path: ".",
            exclude: ["bursar-signer.entitlements", "Package.swift"],
            sources: ["EnclaveSigner.swift", "bursar-signer.swift"]
        ),
    ]
)
