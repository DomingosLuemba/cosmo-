import Foundation

/// Espelha `backend/src/types/keyboard.ts` e
/// `mac-agent/Sources/CosmoMacAgent/InputEvent.swift` — os três precisam
/// ficar em sincronia.
enum MacModifier: String, Codable, CaseIterable, Identifiable {
    case command
    case shift
    case option
    case control
    case function

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .command: return "⌘"
        case .shift: return "⇧"
        case .option: return "⌥"
        case .control: return "⌃"
        case .function: return "fn"
        }
    }
}

enum MacInputEvent: Encodable {
    /// Digitação comum. O agente injeta como string Unicode, então acento e
    /// emoji chegam intactos independente do layout do Mac.
    case text(String)
    /// Tecla nomeada ("return", "escape", "left") ou caractere de atalho.
    case key(String, [MacModifier])

    private enum CodingKeys: String, CodingKey {
        case type, text, key, modifiers
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .text(let text):
            try container.encode("text", forKey: .type)
            try container.encode(text, forKey: .text)
        case .key(let key, let modifiers):
            try container.encode("key", forKey: .type)
            try container.encode(key, forKey: .key)
            if !modifiers.isEmpty {
                try container.encode(modifiers, forKey: .modifiers)
            }
        }
    }
}

/// Resultado de `POST /mac/pair`. O `token` autoriza cada `POST /mac/input`.
struct MacPairing: Codable, Equatable {
    let agentId: String
    let agentName: String
    let token: String
}

/// Resultado de `GET /mac/status`.
struct MacStatus: Codable {
    let paired: Bool
    let online: Bool
    let agentName: String?
}
