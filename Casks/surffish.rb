# Rendered from Casks/surffish.rb.tmpl; update checksums from the published ZIP assets.
cask "surffish" do
  depends_on arch: :arm64

  version "0.1.0"
  sha256 "a106edb23428abd9a4bba7a867cb521a366c9bd43b26eea3f133c54d9407e412"

  url "https://github.com/PylotLight/Surffish/releases/download/v#{version}/Surffish-#{version}-mac-arm64.zip"
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
