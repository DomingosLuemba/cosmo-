import EventKit
import UIKit

/// Implementações reais de cada ação do catálogo (`backend/src/agent/tools.ts`).
/// Cada função aqui é chamada tanto pelo `ActionExecutor` (ações vindas do
/// backend) quanto pelos `AppIntent`s (quando disparadas via Siri/Atalhos).
enum PhoneActions {
    enum ActionError: Error, CustomStringConvertible {
        case appNotFound(String)
        case permissionDenied(String)
        case notImplemented(String)

        var description: String {
            switch self {
            case .appNotFound(let name): return "App não encontrado: \(name)"
            case .permissionDenied(let what): return "Permissão negada: \(what)"
            case .notImplemented(let what): return "Ainda não implementado: \(what)"
            }
        }
    }

    /// Abre um app por URL scheme. Requer que o esquema esteja mapeado —
    /// a Apple não expõe um jeito genérico de "abrir app pelo nome".
    static func openApp(named appName: String) async throws {
        let knownSchemes: [String: String] = [
            "spotify": "spotify://",
            "mensagens": "sms:",
            "mail": "message://",
            "calendário": "calshow://",
            "atalhos": "shortcuts://",
        ]
        guard let scheme = knownSchemes[appName.lowercased()],
              let url = URL(string: scheme) else {
            throw ActionError.appNotFound(appName)
        }
        await MainActor.run {
            UIApplication.shared.open(url)
        }
    }

    static func createReminder(title: String, dueDateISO: String?, notes: String?) async throws {
        let store = EKEventStore()
        guard try await store.requestFullAccessToReminders() else {
            throw ActionError.permissionDenied("Lembretes")
        }

        let reminder = EKReminder(eventStore: store)
        reminder.title = title
        reminder.notes = notes
        reminder.calendar = store.defaultCalendarForNewReminders()

        if let dueDateISO, let date = ISO8601DateFormatter().date(from: dueDateISO) {
            reminder.dueDateComponents = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute], from: date
            )
        }

        try store.save(reminder, commit: true)
    }

    static func createCalendarEvent(title: String, startISO: String, endISO: String, location: String?) async throws {
        let store = EKEventStore()
        guard try await store.requestFullAccessToEvents() else {
            throw ActionError.permissionDenied("Calendário")
        }

        guard let start = ISO8601DateFormatter().date(from: startISO),
              let end = ISO8601DateFormatter().date(from: endISO) else {
            throw ActionError.notImplemented("Formato de data inválido")
        }

        let event = EKEvent(eventStore: store)
        event.title = title
        event.startDate = start
        event.endDate = end
        event.location = location
        event.calendar = store.defaultCalendarForNewEvents

        try store.save(event, span: .thisEvent)
    }

    /// A Apple não permite enviar SMS/mensagem silenciosamente em nome do
    /// usuário: no máximo se abre a tela de composição já preenchida, e o
    /// envio final exige um toque humano. Isso é reforçado também pela
    /// política de sensibilidade do backend (compose_message é sempre
    /// approval_required).
    @MainActor
    static func composeMessage(contact: String, body: String) throws {
        throw ActionError.notImplemented(
            "Apresentar MFMessageComposeViewController a partir da UI do app (ver ContentView)"
        )
    }
}
