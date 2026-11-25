import SwiftUI

@MainActor
struct BrowserNavigationErrorView: View {
    let error: BrowserNavigationError
    let canGoBack: Bool
    let onRetry: () -> Void
    let onGoBackOrNewTab: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.86)

            VStack(spacing: 16) {
                Image(systemName: error.symbolName)
                    .font(.system(size: 34, weight: .regular))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)

                Text(error.title)
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)

                Text(error.message)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                if let siteName = error.siteName {
                    Text(siteName)
                        .font(.callout.monospaced())
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .accessibilityLabel("Site: \(siteName)")
                }

                HStack(spacing: 10) {
                    Button(canGoBack ? "Go Back" : "New Tab", action: onGoBackOrNewTab)
                        .buttonStyle(.bordered)

                    Button("Try Again", action: onRetry)
                        .buttonStyle(.borderedProminent)
                        .keyboardShortcut(.defaultAction)
                }
                .padding(.top, 4)
            }
            .padding(32)
            .frame(maxWidth: 480)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
            }
            .padding(24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("browser-navigation-error")
    }
}
