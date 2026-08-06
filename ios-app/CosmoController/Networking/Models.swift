import Foundation

/// Valor JSON genérico, usado para o campo `input` das ações (schema livre,
/// definido pelo catálogo de tools do backend em `agent/tools.ts`).
enum JSONValue: Codable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(String.self) { self = .string(value); return }
        if let value = try? container.decode(Double.self) { self = .number(value); return }
        if let value = try? container.decode(Bool.self) { self = .bool(value); return }
        if let value = try? container.decode([String: JSONValue].self) { self = .object(value); return }
        if let value = try? container.decode([JSONValue].self) { self = .array(value); return }
        self = .null
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }
}

/// Espelha `backend/src/types/actions.ts` — mantenha os dois em sincronia.
struct DeviceAction: Codable, Identifiable {
    let id: String
    let userId: String
    let deviceId: String
    let toolName: String
    let input: [String: JSONValue]
    let sensitivity: String
    var status: String
}

struct PendingApproval: Codable, Identifiable {
    let id: String
    let deviceId: String
    let action: DeviceAction
    let reason: String
    let createdAt: String
}

struct CommandResponse: Codable {
    let reply: String
    let queuedActions: [DeviceAction]
    let pendingApprovals: [String]
}

struct ActionExecutionResult {
    let actionId: String
    let payload: [String: String]
    let error: String?
}
