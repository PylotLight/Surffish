import Network
import WebKit

public enum WebKitProxyController {
    public static func apply(port: UInt16?, to dataStore: WKWebsiteDataStore = .default()) {
        guard let port,
              let endpointPort = NWEndpoint.Port(rawValue: port) else {
            dataStore.proxyConfigurations = nil
            return
        }

        let endpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: endpointPort)
        dataStore.proxyConfigurations = [ProxyConfiguration(socksv5Proxy: endpoint)]
    }
}
