import Foundation
import WebKit

public final class AdBlockManager {
    public static let shared = AdBlockManager()
    
    public private(set) var isEnabled: Bool = true
    private var ruleList: WKContentRuleList?
    private let ruleListIdentifier = "surffish-adblock-rules"
    
    private let defaultRulesJson = """
    [
        {
            "trigger": { "url-filter": ".*(doubleclick\\\\.net|googlesyndication\\\\.com|adservice\\\\.google\\\\.com|adnxs\\\\.com|criteo\\\\.net|amazon-adsystem\\\\.com|moatads\\\\.com|taboola\\\\.com|outbrain\\\\.com|scorecardresearch\\\\.com).*" },
            "action": { "type": "block" }
        },
        {
            "trigger": { "url-filter": ".*" },
            "action": {
                "type": "css-display-none",
                "selector": ".ad, .ads, .ad-banner, .advertisement, [id^='google_ads_'], div[class*='sponsored'], iframe[src*='doubleclick']"
            }
        }
    ]
    """
    
    private init() {
        let storeDir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("surffish-crl-store")
        try? FileManager.default.createDirectory(at: storeDir, withIntermediateDirectories: true)
        
        guard let store = WKContentRuleListStore(url: storeDir) else { return }
        store.compileContentRuleList(forIdentifier: ruleListIdentifier, encodedContentRuleList: defaultRulesJson) { [weak self] list, error in
            if let error = error {
                print("[AdBlock] Compile error: \(error)")
                return
            }
            self?.ruleList = list
            print("[AdBlock] ContentRuleList compiled successfully")
        }
    }
    
    public func applyTo(userContentController: WKUserContentController) {
        if isEnabled, let list = ruleList {
            userContentController.add(list)
        }
    }
    
    public func toggle() -> Bool {
        isEnabled.toggle()
        guard let list = ruleList else { return isEnabled }
        for tab in TabManager.shared.tabs {
            let controller = tab.webView.configuration.userContentController
            if isEnabled {
                controller.add(list)
            } else {
                controller.remove(list)
            }
            tab.webView.reload()
        }
        return isEnabled
    }
}
