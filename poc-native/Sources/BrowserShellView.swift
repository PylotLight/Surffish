import AppKit
import Observation
import SwiftUI

@MainActor
@Observable
public final class BrowserShellLayoutModel {
    public var sidebarWidth: CGFloat = 280

    public init() {}
}

/// SwiftUI owns the browser chrome layout; AppKit owns the NSWindow and hosts
/// the native toolbar, sidebar bridge, and WebKit page card.
@MainActor
public struct BrowserShellView: View {
    @Bindable private var layout: BrowserShellLayoutModel
    private let toolbar: NSView
    private let sidebar: NSView
    private let pageCard: NSView

    public init(layout: BrowserShellLayoutModel, toolbar: NSView, sidebar: NSView, pageCard: NSView) {
        self.layout = layout
        self.toolbar = toolbar
        self.sidebar = sidebar
        self.pageCard = pageCard
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Color.clear.frame(width: layout.sidebarWidth)
                HostedAppKitView(view: toolbar)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
            }
            .frame(height: 50)

            HStack(spacing: 0) {
                HostedAppKitView(view: sidebar)
                    .frame(width: layout.sidebarWidth)
                    .frame(maxHeight: .infinity)

                HostedAppKitView(view: pageCard)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.leading, 8)
                    .padding(.trailing, 8)
                    .padding(.top, 8)
                    .padding(.bottom, 8)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.clear)
        .ignoresSafeArea()
        .animation(.timingCurve(0.16, 1, 0.3, 1, duration: 0.34), value: layout.sidebarWidth)
    }
}

@MainActor
private struct HostedAppKitView: NSViewRepresentable {
    let view: NSView

    func makeNSView(context: Context) -> NSView { view }

    func updateNSView(_ nsView: NSView, context: Context) {}
}
