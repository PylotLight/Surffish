// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "SockfishNativePOC",
    platforms: [.macOS("15.4")],
    products: [
        .library(name: "NativeCore", targets: ["NativeCore"]),
        .executable(name: "SockfishNative", targets: ["SockfishNative"])
    ],
    targets: [
        .target(name: "NativeCore"),
        .executableTarget(name: "SockfishNative", dependencies: ["NativeCore"]),
        .testTarget(
            name: "NativeCoreTests",
            dependencies: ["NativeCore"],
            resources: [.copy("Fixtures")]
        )
    ],
    swiftLanguageVersions: [.v5]
)
