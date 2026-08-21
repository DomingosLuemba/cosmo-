// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "cosmo-mac-agent",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "CosmoMacAgent",
            path: "Sources/CosmoMacAgent"
        )
    ]
)
