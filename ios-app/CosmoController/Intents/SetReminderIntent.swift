import AppIntents

struct SetReminderIntent: AppIntent {
    static var title: LocalizedStringResource = "Criar lembrete (Cosmo)"
    static var description = IntentDescription("Cria um lembrete no app Lembretes.")

    @Parameter(title: "Título")
    var title: String

    @Parameter(title: "Data/hora", isOptional: true)
    var dueDate: Date?

    @Parameter(title: "Notas", isOptional: true)
    var notes: String?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let dueDateISO = dueDate.map { ISO8601DateFormatter().string(from: $0) }
        try await PhoneActions.createReminder(title: title, dueDateISO: dueDateISO, notes: notes)
        return .result(dialog: "Lembrete \"\(title)\" criado.")
    }
}
