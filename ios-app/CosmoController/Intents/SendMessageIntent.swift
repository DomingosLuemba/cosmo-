import AppIntents

/// Mensagens são sempre sensíveis (ver docs/POLICY.md): este intent não
/// envia nada sozinho — ele abre o app Cosmo na tela de aprovação, onde o
/// usuário confirma antes do envio real.
struct SendMessageIntent: AppIntent {
    static var title: LocalizedStringResource = "Enviar mensagem (Cosmo)"
    static var description = IntentDescription(
        "Prepara uma mensagem para revisão — o envio exige confirmação no app."
    )
    static var openAppWhenRun = true

    @Parameter(title: "Contato")
    var contact: String

    @Parameter(title: "Mensagem")
    var body: String

    func perform() async throws -> some IntentResult & ProvidesDialog {
        // A ida real ao backend acontece via PendingApprovalStore assim que
        // o app abre (ver Approval/PendingApprovalStore.swift) — este intent
        // só sinaliza a intenção, ele nunca compõe/envia diretamente.
        return .result(dialog: "Abrindo Cosmo para você revisar a mensagem para \(contact).")
    }
}
