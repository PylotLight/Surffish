# Rendered from Casks/surffish.rb.tmpl; update checksums from the published ZIP asset.
# One-off: v0.2.0-beta.2 was re-released, so this cask installs the rebuilt "-2" asset;
# the original zip stays on the release for the npm launcher's pinned checksum.
cask "surffish" do
  depends_on arch: :arm64

  version "0.2.0-beta.2"
  sha256 "d4580c6cfce3111565d888b4ba77a4bb16fb6f391879809fb9129e61e46841f0"

  url "https://github.com/PylotLight/Surffish/releases/download/v#{version}/Surffish-0.2.0-beta.2-2-mac-arm64.zip"
  name "Surffish"
  desc "A focused desktop browser with an adjustable sidebar and SOCKS5 proxy support"
  homepage "https://github.com/PylotLight/Surffish"

  depends_on macos: :ventura

  app "Surffish.app"

  caveats <<~EOS
    Surffish is unsigned and not notarized. If macOS reports the app is "damaged",
    verify that it came from the official Surffish release and that you trust it,
    then run:
      xattr -cr /Applications/Surffish.app
    Homebrew's --no-quarantine option is no longer available.
  EOS
end
