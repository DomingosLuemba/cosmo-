import CoreGraphics
import Foundation

/// Espelha `backend/src/types/keyboard.ts` — mantenha os dois em sincronia.
enum Modifier: String, Decodable {
    case command
    case shift
    case option
    case control
    case function

    var eventFlag: CGEventFlags {
        switch self {
        case .command: return .maskCommand
        case .shift: return .maskShift
        case .option: return .maskAlternate
        case .control: return .maskControl
        case .function: return .maskSecondaryFn
        }
    }
}

enum InputEvent {
    /// Digitação comum — injetada como string Unicode (independe do layout).
    case text(String)
    /// Tecla nomeada ("return", "escape") ou caractere de atalho ("c" + ⌘).
    case key(String, [Modifier])
}

extension InputEvent: Decodable {
    private enum CodingKeys: String, CodingKey {
        case type, text, key, modifiers
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "text":
            self = .text(try container.decode(String.self, forKey: .text))
        case "key":
            let key = try container.decode(String.self, forKey: .key)
            let modifiers = try container.decodeIfPresent([Modifier].self, forKey: .modifiers) ?? []
            self = .key(key, modifiers)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type,
                in: container,
                debugDescription: "Tipo de evento desconhecido: \(type)"
            )
        }
    }
}

/// Mensagens que o backend empurra pelo WebSocket (`backend/src/mac/relay.ts`).
struct RelayMessage: Decodable {
    let type: String
    let pairingCode: String?
    let paired: Bool?
    let userId: String?
    let events: [InputEvent]?
}
