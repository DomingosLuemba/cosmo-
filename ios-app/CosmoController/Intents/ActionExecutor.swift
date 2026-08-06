import Foundation

/// Ponto único que recebe uma `DeviceAction` vinda do backend, despacha para
/// a implementação real em `PhoneActions`, e reporta o resultado de volta.
enum ActionExecutor {
    static func pollAndExecute(userId: String, deviceId: String) async {
        do {
            guard let action = try await BackendClient.shared.fetchNextAction(deviceId: deviceId) else {
                return
            }
            await execute(action, userId: userId)
        } catch {
            print("[ActionExecutor] falha ao buscar próxima ação: \(error)")
        }
    }

    static func execute(_ action: DeviceAction, userId: String) async {
        do {
            try await perform(action)
            try await BackendClient.shared.reportResult(
                deviceId: action.deviceId, userId: userId, actionId: action.id,
                result: ["status": "ok"], error: nil
            )
        } catch {
            try? await BackendClient.shared.reportResult(
                deviceId: action.deviceId, userId: userId, actionId: action.id,
                result: nil, error: String(describing: error)
            )
        }
    }

    private static func perform(_ action: DeviceAction) async throws {
        switch action.toolName {
        case "open_app":
            let name = action.input["appName"]?.stringValue ?? ""
            try await PhoneActions.openApp(named: name)

        case "create_reminder":
            let title = action.input["title"]?.stringValue ?? ""
            let dueDate = action.input["dueDate"]?.stringValue
            let notes = action.input["notes"]?.stringValue
            try await PhoneActions.createReminder(title: title, dueDateISO: dueDate, notes: notes)

        case "create_calendar_event":
            let title = action.input["title"]?.stringValue ?? ""
            let start = action.input["startDate"]?.stringValue ?? ""
            let end = action.input["endDate"]?.stringValue ?? ""
            let location = action.input["location"]?.stringValue
            try await PhoneActions.createCalendarEvent(
                title: title, startISO: start, endISO: end, location: location
            )

        case "compose_message":
            let contact = action.input["contact"]?.stringValue ?? ""
            let body = action.input["body"]?.stringValue ?? ""
            try await PhoneActions.composeMessage(contact: contact, body: body)

        case "set_volume", "control_home_device", "web_search":
            throw PhoneActions.ActionError.notImplemented(action.toolName)

        default:
            throw PhoneActions.ActionError.notImplemented(action.toolName)
        }
    }
}
