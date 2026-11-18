# Rendered from Casks/surffish.rb.tmpl; update checksums from the published ZIP asset.
cask "surffish" do
  depends_on arch: :arm64

  version "0.2.0-beta.9"
  sha256 "7dfd7f81c5412af5a7255b268c7cd52d57d85733f7a08458368bd52400bd75ff"

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
