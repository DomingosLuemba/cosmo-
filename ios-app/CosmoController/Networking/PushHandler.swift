import UIKit

/// Recebe a push que o backend envia (`approval/push.ts`) quando há uma nova
/// ação/aprovação. O payload vem com `content-available: 1`, então além de
/// mostrar o alerta o iOS acorda o app em background e dispara o polling de
/// `ActionExecutor`.
///
/// Requer as capabilities "Push Notifications" e "Background Modes →
/// Remote notifications" habilitadas no target do Xcode.
final class PushHandler: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        application.registerForRemoteNotifications()
        return true
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        // TODO: extrair userId/deviceId reais da sessão do usuário logado.
        let userId = CurrentUser.id
        let deviceId = CurrentUser.deviceId

        await ActionExecutor.pollAndExecute(userId: userId, deviceId: deviceId)
        await PendingApprovalStore.shared.refresh(deviceId: deviceId)
        return .newData
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        CurrentUser.deviceToken = token
    }
}

/// Placeholder de identidade do usuário/dispositivo — troque por um sistema
/// de login/keychain real.
enum CurrentUser {
    static let id = "demo-user"
    static let deviceId = "demo-device"
    static var deviceToken = ""
}
