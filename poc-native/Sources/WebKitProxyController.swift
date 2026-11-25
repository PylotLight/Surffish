import Network
import WebKit

@MainActor
public enum WebKitProxyController {
    public static func apply(port: UInt16?) {
        apply(port: port, to: WKWebsiteDataStore.default())
    }

    public static func apply(port: UInt16?, to dataStore: WKWebsiteDataStore) {
        guard let port,
              let endpointPort = NWEndpoint.Port(rawValue: port) else {
            dataStore.proxyConfigurations = []
            return
        }

        let endpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: endpointPort)
        var proxy = ProxyConfiguration(socksv5Proxy: endpoint)
        proxy.allowFailover = false
        dataStore.proxyConfigurations = [proxy]
    }
}
