// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CaptureMacOS",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "capture-probe", targets: ["CaptureProbe"]),
        .executable(name: "vision-benchmark", targets: ["VisionBenchmark"]),
        .executable(name: "capture-core", targets: ["CaptureCore"]),
    ],
    targets: [
        .executableTarget(name: "CaptureProbe"),
        .executableTarget(name: "VisionBenchmark"),
        .executableTarget(
            name: "CaptureCore",
            exclude: ["Info.plist"],
            linkerSettings: [
                // Embed privacy usage strings so TCC does not abort requestAccess.
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", "/Users/sterlingdigital/eyeballs-capture-core/native/capture-macos/Sources/CaptureCore/Info.plist",
                ], .when(platforms: [.macOS])),
            ]
        ),
    ]
)
