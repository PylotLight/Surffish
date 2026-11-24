import Foundation
import LocalAuthentication

public final class BrambleNativeBridge {
    public static let shared = BrambleNativeBridge()
    
    private init() {}
    
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
}
