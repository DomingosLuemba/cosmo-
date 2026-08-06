import SwiftUI

@main
struct CosmoControllerApp: App {
    @UIApplicationDelegateAdaptor(PushHandler.self) private var pushHandler

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
