// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CaptureMacOS",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "capture-probe", targets: ["CaptureProbe"]),
        .executable(name: "vision-benchmark", targets: ["VisionBenchmark"]),
    ],
    targets: [
        .executableTarget(name: "CaptureProbe"),
        .executableTarget(name: "VisionBenchmark"),
    ]
)
