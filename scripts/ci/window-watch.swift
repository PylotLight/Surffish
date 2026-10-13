// Watches what the Mac runner's screen actually shows while hidden smokes run (Mac CI only).
//   swiftc -O -o window-watch scripts/ci/window-watch.swift
//   ./window-watch [owner-name-substring=Electron] [interval-ms=200] > watch.log &   (SIGTERM/SIGINT to stop)
// Every interval it samples CGWindowListCopyWindowInfo(.optionOnScreenOnly) for windows whose owning
// process name contains the filter, and which app is frontmost / owns the menu bar. It logs each window
// the first time it is on screen (bounds, alpha, layer) and each time the frontmost app changes to or
// from a matching app, then prints one JSON summary line on exit:
//   {"samples":N,"onScreenSamples":N,"windowsSeen":N,"maxAlpha":0.01,"frontmostSamples":N,"menuBarSamples":N}
// Window titles need Screen Recording permission; owner name, pid, bounds and alpha don't.
import AppKit
import Foundation

let args = CommandLine.arguments
let filter = args.count > 1 ? args[1] : "Electron"
let intervalMs = args.count > 2 ? (Double(args[2]) ?? 200) : 200

var samples = 0
var onScreenSamples = 0
var frontmostSamples = 0
var menuBarSamples = 0
var maxAlpha = 0.0
var seen = Set<Int>()
var wasFront = false
let started = Date()

func stamp() -> String { String(format: "%.1fs", Date().timeIntervalSince(started)) }
func say(_ line: String) { FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!) }
func matches(_ name: String?) -> Bool { (name ?? "").localizedCaseInsensitiveContains(filter) }

func sample() {
  samples += 1
  var onScreen = false
  if let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
    for info in list where matches(info[kCGWindowOwnerName as String] as? String) {
      let number = info[kCGWindowNumber as String] as? Int ?? -1
      let alpha = info[kCGWindowAlpha as String] as? Double ?? 1
      let layer = info[kCGWindowLayer as String] as? Int ?? 0
      let bounds = info[kCGWindowBounds as String] as? [String: Any] ?? [:]
      let w = bounds["Width"] as? Double ?? 0
      let h = bounds["Height"] as? Double ?? 0
      if w < 2 || h < 2 { continue }
      onScreen = true
      maxAlpha = max(maxAlpha, alpha)
      if !seen.contains(number) {
        seen.insert(number)
        let pid = info[kCGWindowOwnerPID as String] as? Int ?? -1
        let x = bounds["X"] as? Double ?? 0
        let y = bounds["Y"] as? Double ?? 0
        say("[window-watch] \(stamp()) ON SCREEN window \(number) pid \(pid) \(Int(w))x\(Int(h)) at \(Int(x)),\(Int(y)) alpha \(alpha) layer \(layer)")
      }
    }
  }
  if onScreen { onScreenSamples += 1 }
  let front = NSWorkspace.shared.frontmostApplication
  let isFront = matches(front?.localizedName)
  if isFront { frontmostSamples += 1 }
  if matches(NSWorkspace.shared.menuBarOwningApplication?.localizedName) { menuBarSamples += 1 }
  if isFront != wasFront {
    say("[window-watch] \(stamp()) frontmost app: \(front?.localizedName ?? "?") (pid \(front?.processIdentifier ?? -1))\(isFront ? " <- A MATCHING APP TOOK FOCUS" : "")")
    wasFront = isFront
  }
}

func finish() -> Never {
  say("[window-watch-json] {\"samples\":\(samples),\"onScreenSamples\":\(onScreenSamples),\"windowsSeen\":\(seen.count),\"maxAlpha\":\(maxAlpha),\"frontmostSamples\":\(frontmostSamples),\"menuBarSamples\":\(menuBarSamples)}")
  exit(0)
}

signal(SIGTERM, SIG_IGN)
signal(SIGINT, SIG_IGN)
let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
term.setEventHandler { finish() }
term.resume()
let int = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
int.setEventHandler { finish() }
int.resume()

say("[window-watch] watching windows of processes matching \"\(filter)\" every \(Int(intervalMs)) ms; frontmost at start: \(NSWorkspace.shared.frontmostApplication?.localizedName ?? "?")")
Timer.scheduledTimer(withTimeInterval: intervalMs / 1000, repeats: true) { _ in sample() }
RunLoop.main.run()
