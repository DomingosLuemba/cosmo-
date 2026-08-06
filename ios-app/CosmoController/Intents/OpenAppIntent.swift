import AppIntents

/// Expõe "abrir app" para a Siri/Atalhos, além de ser usada pelo
/// `ActionExecutor` quando a ação vem do backend.
struct OpenAppIntent: AppIntent {
    static var title: LocalizedStringResource = "Abrir app (Cosmo)"
    static var description = IntentDescription("Abre um app conhecido pelo Cosmo.")

    @Parameter(title: "Nome do app")
    var appName: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try await PhoneActions.openApp(named: appName)
        return .result(dialog: "Abrindo \(appName).")
    }
}
