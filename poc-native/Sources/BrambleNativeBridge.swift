import Foundation
import LocalAuthentication
import Security
import CommonCrypto
import WebKit

public final class BrambleNativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    public static let shared = BrambleNativeBridge()
    
    private let keychainService = "com.surffish.native.bramble"
    private let keychainAccount = "touchid-prf-secret"
    private var registeredControllers = NSHashTable<WKUserContentController>.weakObjects()
    
    public override init() {
        super.init()
    }
    
    public func canUseBiometrics() -> Bool {
        let context = LAContext()
        var error: NSError?
        return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
    }
    
    public func authenticateWithBiometrics(reason: String = "Unlock Bramble Vault", completion: @escaping (Bool, String?) -> Void) {
        let context = LAContext()
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, error in
            DispatchQueue.main.async {
                if success {
                    completion(true, nil)
                } else {
                    completion(false, error?.localizedDescription ?? "Authentication cancelled or failed")
                }
            }
        }
    }
    
    // MARK: - Secret Key & HMAC for WebAuthn PRF
    private func getOrCreateDeviceSecret() -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, data.count == 32 {
            return data
        }
        
        // Generate new 32-byte secret
        var newSecret = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, 32, &newSecret) == errSecSuccess else {
            return nil
        }
        let secretData = Data(newSecret)
        
        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecValueData as String: secretData,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]
        SecItemDelete(addQuery as CFDictionary)
        SecItemAdd(addQuery as CFDictionary, nil)
        
        return secretData
    }
    
    private func computeHmac(salt: Data) -> Data? {
        guard let secret = getOrCreateDeviceSecret() else { return nil }
        var hmac = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        secret.withUnsafeBytes { secretBytes in
            salt.withUnsafeBytes { saltBytes in
                CCHmac(
                    CCHmacAlgorithm(kCCHmacAlgSHA256),
                    secretBytes.baseAddress,
                    secret.count,
                    saltBytes.baseAddress,
                    salt.count,
                    &hmac
                )
            }
        }
        return Data(hmac)
    }
    
    // MARK: - WKUserContentController Injection
    public func applyTo(userContentController: WKUserContentController) {
        if !registeredControllers.contains(userContentController) {
            registeredControllers.add(userContentController)
            let script = WKUserScript(
                source: BrambleNativeBridge.biometricsPolyfillJS,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false,
                in: .page
            )
            userContentController.addUserScript(script)
            userContentController.addScriptMessageHandler(self as WKScriptMessageHandlerWithReply, contentWorld: .page, name: "brambleBiometrics")
            print("[BrambleNativeBridge] Registered biometrics bridge with userContentController")
        }
    }
    
    // MARK: - WKScriptMessageHandlerWithReply
    public func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard let dict = message.body as? [String: Any],
              let action = dict["action"] as? String else {
            replyHandler(nil, "Invalid message body")
            return
        }
        
        print("[BrambleNativeBridge] Received action: \(action)")
        
        switch action {
        case "isUvpaa":
            replyHandler(["available": canUseBiometrics()], nil)
            
        case "create":
            let saltData: Data
            if let saltB64 = dict["salt"] as? String, let decoded = Data(base64Encoded: saltB64) {
                saltData = decoded
            } else if let saltArr = dict["salt"] as? [NSNumber] {
                saltData = Data(saltArr.map { $0.uint8Value })
            } else {
                saltData = Data()
            }
            
            print("[BrambleNativeBridge] Prompting Touch ID for registration (salt: \(saltData.count) bytes)...")
            authenticateWithBiometrics(reason: "Register Touch ID for Bramble Vault") { [weak self] success, err in
                guard success, let self = self else {
                    print("[BrambleNativeBridge] Touch ID registration cancelled/failed: \(err ?? "unknown")")
                    replyHandler(nil, err ?? "NotAllowedError")
                    return
                }
                
                var credIdBytes = [UInt8](repeating: 0, count: 16)
                _ = SecRandomCopyBytes(kSecRandomDefault, 16, &credIdBytes)
                let credId = Data(credIdBytes)
                
                guard let hmac = self.computeHmac(salt: saltData) else {
                    print("[BrambleNativeBridge] Error: computeHmac failed")
                    replyHandler(nil, "Failed to compute HMAC")
                    return
                }
                
                print("[BrambleNativeBridge] Touch ID registration success! Generated credId: \(credId.base64EncodedString())")
                replyHandler([
                    "ok": true,
                    "credentialId": credId.base64EncodedString(),
                    "hmacSecret": hmac.base64EncodedString()
                ], nil)
            }
            
        case "get":
            let saltData: Data
            if let saltB64 = dict["salt"] as? String, let decoded = Data(base64Encoded: saltB64) {
                saltData = decoded
            } else if let saltArr = dict["salt"] as? [NSNumber] {
                saltData = Data(saltArr.map { $0.uint8Value })
            } else {
                saltData = Data()
            }
            
            print("[BrambleNativeBridge] Prompting Touch ID for unlock (salt: \(saltData.count) bytes)...")
            authenticateWithBiometrics(reason: "Unlock Bramble Vault with Touch ID") { [weak self] success, err in
                guard success, let self = self else {
                    print("[BrambleNativeBridge] Touch ID unlock cancelled/failed: \(err ?? "unknown")")
                    replyHandler(nil, err ?? "NotAllowedError")
                    return
                }
                
                guard let hmac = self.computeHmac(salt: saltData) else {
                    print("[BrambleNativeBridge] Error: computeHmac failed")
                    replyHandler(nil, "Failed to compute HMAC")
                    return
                }
                
                print("[BrambleNativeBridge] Touch ID unlock success!")
                replyHandler([
                    "ok": true,
                    "hmacSecret": hmac.base64EncodedString()
                ], nil)
            }
            
        default:
            replyHandler(nil, "Unknown action: \(action)")
        }
    }
    
    public static let biometricsPolyfillJS = """
    (() => {
      if (window.__brambleBiometricsInstalled) return;
      window.__brambleBiometricsInstalled = true;

      function base64ToUint8(base64) {
        const bin = atob(base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      }

      function uint8ToBase64(bytes) {
        let bin = '';
        const len = bytes.byteLength || bytes.length;
        const u8 = (bytes instanceof Uint8Array) ? bytes : new Uint8Array(bytes.buffer || bytes);
        for (let i = 0; i < len; i++) bin += String.fromCharCode(u8[i]);
        return btoa(bin);
      }

      function toUint8Array(val) {
        if (!val) return new Uint8Array(0);
        if (val instanceof Uint8Array) return val;
        if (val instanceof ArrayBuffer) return new Uint8Array(val);
        if (val.buffer instanceof ArrayBuffer) return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
        return new Uint8Array(val);
      }

      // 1. Hook PublicKeyCredential
      if (window.PublicKeyCredential) {
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
        if (typeof PublicKeyCredential.getClientCapabilities === 'function') {
          PublicKeyCredential.getClientCapabilities = async () => ({
            conditionalCreate: true,
            conditionalGet: true,
            hybridTransport: true,
            passkeyPlatformAuthenticator: true,
            userVerifyingPlatformAuthenticator: true,
            relatedOrigins: true
          });
        }
      }

      // 2. Hook navigator.credentials.create & get
      if (navigator.credentials) {
        const origCreate = navigator.credentials.create.bind(navigator.credentials);
        const origGet = navigator.credentials.get.bind(navigator.credentials);

        const customCreate = async function(options) {
          console.log("[BrambleNativeBridge] credentials.create invoked with options:", options);
          const pubKey = options?.publicKey;
          const isPlatform = (
            pubKey?.authenticatorSelection?.authenticatorAttachment === 'platform' ||
            pubKey?.extensions?.prf != null
          );

          if (!isPlatform || !window.webkit?.messageHandlers?.brambleBiometrics) {
            return origCreate(options);
          }

          let saltB64 = "";
          const prfFirst = pubKey?.extensions?.prf?.eval?.first;
          if (prfFirst) {
            saltB64 = uint8ToBase64(toUint8Array(prfFirst));
          } else {
            saltB64 = uint8ToBase64(crypto.getRandomValues(new Uint8Array(32)));
          }

          try {
            console.log("[BrambleNativeBridge] Posting create to native handler...");
            const res = await window.webkit.messageHandlers.brambleBiometrics.postMessage({
              action: "create",
              salt: saltB64
            });
            console.log("[BrambleNativeBridge] Native handler replied:", res);
            if (!res || !res.ok) {
              throw new DOMException("The operation either timed out or was not allowed.", "NotAllowedError");
            }

            const rawId = base64ToUint8(res.credentialId).buffer;
            const hmac = base64ToUint8(res.hmacSecret).buffer;

            return {
              id: res.credentialId,
              rawId: rawId,
              type: "public-key",
              response: {
                clientDataJSON: new Uint8Array([123, 125]).buffer,
                attestationObject: new Uint8Array([160]).buffer,
                getAuthenticatorData: () => new Uint8Array(37).buffer
              },
              getClientExtensionResults: () => ({
                prf: {
                  results: {
                    first: hmac
                  }
                }
              })
            };
          } catch (err) {
            console.error("[BrambleNativeBridge] create error:", err);
            throw new DOMException(err?.message || "Registration was cancelled or timed out.", "NotAllowedError");
          }
        };

        const customGet = async function(options) {
          console.log("[BrambleNativeBridge] credentials.get invoked with options:", options);
          const pubKey = options?.publicKey;
          const hasPrf = (pubKey?.extensions?.prf != null);

          if (!hasPrf || !window.webkit?.messageHandlers?.brambleBiometrics) {
            return origGet(options);
          }

          let saltB64 = "";
          const prfFirst = pubKey?.extensions?.prf?.eval?.first;
          if (prfFirst) {
            saltB64 = uint8ToBase64(toUint8Array(prfFirst));
          }

          try {
            console.log("[BrambleNativeBridge] Posting get to native handler...");
            const res = await window.webkit.messageHandlers.brambleBiometrics.postMessage({
              action: "get",
              salt: saltB64
            });
            console.log("[BrambleNativeBridge] Native handler replied:", res);
            if (!res || !res.ok) {
              throw new DOMException("The operation either timed out or was not allowed.", "NotAllowedError");
            }

            const hmac = base64ToUint8(res.hmacSecret).buffer;
            const credId = pubKey?.allowCredentials?.[0]?.id || new Uint8Array(16).buffer;

            return {
              id: typeof credId === 'string' ? credId : "touchid",
              rawId: credId instanceof ArrayBuffer ? credId : (credId.buffer || new Uint8Array(16).buffer),
              type: "public-key",
              response: {
                clientDataJSON: new Uint8Array([123, 125]).buffer,
                authenticatorData: new Uint8Array(37).buffer,
                signature: new Uint8Array(64).buffer,
                userHandle: new Uint8Array(16).buffer
              },
              getClientExtensionResults: () => ({
                prf: {
                  results: {
                    first: hmac
                  }
                }
              })
            };
          } catch (err) {
            console.error("[BrambleNativeBridge] get error:", err);
            throw new DOMException(err?.message || "Unlock was cancelled or timed out.", "NotAllowedError");
          }
        };

        try {
          Object.defineProperty(navigator.credentials, 'create', {
            configurable: true,
            writable: true,
            value: customCreate
          });
          Object.defineProperty(navigator.credentials, 'get', {
            configurable: true,
            writable: true,
            value: customGet
          });
        } catch {
          navigator.credentials.create = customCreate;
          navigator.credentials.get = customGet;
        }
      }
    })();
    """
}

