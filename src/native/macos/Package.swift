// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "SurffishNativePOC",
    platforms: [.macOS("15.4")],
    products: [
        .library(name: "NativeCore", targets: ["NativeCore"]),
        .executable(name: "SurffishNative", targets: ["SurffishNative"])
    ],
    targets: [
        .target(name: "NativeCore"),
        .executableTarget(name: "SurffishNative", dependencies: ["NativeCore"]),
        .testTarget(
            name: "NativeCoreTests",
            dependencies: ["NativeCore"],
            resources: [.copy("Fixtures")]
        )
    ],
    swiftLanguageVersions: [.v5]
)
