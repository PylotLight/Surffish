import AppKit

public protocol FindBarViewDelegate: AnyObject {
    func findBar(_ findBar: FindBarView, didSearch query: String, backwards: Bool)
    func findBarDidClose(_ findBar: FindBarView)
}

public final class FindBarView: NSView, NSTextFieldDelegate {
    public weak var delegate: FindBarViewDelegate?
    public var query: String { searchField.stringValue }

    private let searchField = NSTextField()
    private let statusLabel = NSTextField(labelWithString: "")
    private let previousButton = NSButton()
    private let nextButton = NSButton()
    private let closeButton = NSButton()

    public override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setupUI()
    }

    public required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupUI()
    }

    private func setupUI() {
        wantsLayer = true
        layer?.cornerRadius = 10
        layer?.backgroundColor = NSColor(calibratedWhite: 0.12, alpha: 0.97).cgColor
        layer?.borderColor = NSColor(white: 1, alpha: 0.14).cgColor
        layer?.borderWidth = 1

        searchField.placeholderString = "Find in page"
        searchField.isBordered = false
        searchField.drawsBackground = false
        searchField.focusRingType = .none
        searchField.font = .systemFont(ofSize: 12)
        searchField.delegate = self
        searchField.target = self
        searchField.action = #selector(findNext)
        searchField.setContentHuggingPriority(.defaultLow, for: .horizontal)
        searchField.translatesAutoresizingMaskIntoConstraints = false

        statusLabel.font = .systemFont(ofSize: 10)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.alignment = .right
        statusLabel.lineBreakMode = .byTruncatingTail
        statusLabel.setContentHuggingPriority(.required, for: .horizontal)

        configureButton(previousButton, symbol: "chevron.up", label: "Find previous", action: #selector(findPrevious))
        configureButton(nextButton, symbol: "chevron.down", label: "Find next", action: #selector(findNext))
        configureButton(closeButton, symbol: "xmark", label: "Close find", action: #selector(closeFind))

        let stack = NSStackView(views: [searchField, statusLabel, previousButton, nextButton, closeButton])
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.distribution = .fill
        stack.spacing = 7
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 5),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -5),
            searchField.widthAnchor.constraint(greaterThanOrEqualToConstant: 120),
            statusLabel.widthAnchor.constraint(equalToConstant: 55)
        ])
    }

    private func configureButton(_ button: NSButton, symbol: String, label: String, action: Selector) {
        button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: label)
        button.imagePosition = .imageOnly
        button.bezelStyle = .toolbar
        button.isBordered = false
        button.contentTintColor = .secondaryLabelColor
        button.toolTip = label
        button.setAccessibilityLabel(label)
        button.target = self
        button.action = action
        button.translatesAutoresizingMaskIntoConstraints = false
        button.widthAnchor.constraint(equalToConstant: 22).isActive = true
        button.heightAnchor.constraint(equalToConstant: 24).isActive = true
    }

    public func focusAndSelectAll() {
        window?.makeFirstResponder(searchField)
        searchField.currentEditor()?.selectAll(nil)
    }

    public func setStatus(_ value: String) {
        statusLabel.stringValue = value
    }

    public func controlTextDidChange(_ notification: Notification) {
        delegate?.findBar(self, didSearch: searchField.stringValue, backwards: false)
    }

    public func control(_ control: NSControl, textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
        if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
            delegate?.findBarDidClose(self)
            return true
        }
        if commandSelector == #selector(NSResponder.insertNewline(_:)) {
            findNext(nil)
            return true
        }
        return false
    }

    @objc private func findPrevious(_ sender: Any?) {
        findPreviousOccurrence()
    }

    public func findPreviousOccurrence() {
        delegate?.findBar(self, didSearch: searchField.stringValue, backwards: true)
    }

    @objc private func findNext(_ sender: Any?) {
        findNextOccurrence()
    }

    public func findNextOccurrence() {
        delegate?.findBar(self, didSearch: searchField.stringValue, backwards: false)
    }

    @objc private func closeFind(_ sender: Any?) {
        delegate?.findBarDidClose(self)
    }
}
