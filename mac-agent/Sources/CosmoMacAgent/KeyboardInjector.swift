import CoreGraphics
import Foundation

/// Injeta as teclas recebidas do telefone no Mac, via CGEvent.
///
/// Exige que o processo esteja autorizado em Ajustes → Privacidade e
/// Segurança → Acessibilidade (ver `AccessibilityPermission`). Sem isso os
/// eventos são criados normalmente mas o sistema os descarta em silêncio.
final class KeyboardInjector {
    /// Pausa entre o keyDown e o keyUp da mesma tecla.
    private let pressDelay: useconds_t = 1_200
    /// Pausa entre eventos consecutivos — sem isso alguns apps (Terminal,
    /// Electron) perdem teclas quando o lote chega todo de uma vez.
    private let betweenEventsDelay: useconds_t = 1_800
    /// Teto de UTF-16 por evento Unicode. Strings longas num único evento são
    /// truncadas por vários apps, então quebramos em pedaços.
    private let maxUnitsPerEvent = 16

    private let queue = DispatchQueue(label: "com.cosmo.mac-agent.injector")
    private let source = CGEventSource(stateID: .combinedSessionState)
    private let characterKeyCodes: [Character: CGKeyCode]

    init() {
        // Montado no boot (main thread) porque as APIs de TIS preferem isso;
        // depois só é lido de dentro da fila serial.
        characterKeyCodes = KeyCodes.currentLayoutCharacterMap()
    }

    /// Aplica um lote na ordem em que chegou. Assíncrono: a fila serial
    /// preserva a ordem sem travar o socket.
    func apply(_ events: [InputEvent]) {
        queue.async { [self] in
            for event in events {
                switch event {
                case .text(let text):
                    type(text)
                case .key(let key, let modifiers):
                    press(key: key, modifiers: modifiers)
                }
                usleep(betweenEventsDelay)
            }
        }
    }

    // MARK: - Digitação

    private func type(_ text: String) {
        // "\n" e "\t" como string Unicode não viram Return/Tab de verdade em
        // boa parte dos apps — mandamos como tecla mesmo.
        var buffer = ""

        for character in text {
            switch character {
            case "\n", "\r":
                flush(&buffer)
                post(keyCode: KeyCodes.returnKey, flags: [])
            case "\t":
                flush(&buffer)
                post(keyCode: KeyCodes.tab, flags: [])
            default:
                buffer.append(character)
            }
        }

        flush(&buffer)
    }

    private func flush(_ buffer: inout String) {
        guard !buffer.isEmpty else { return }
        for chunk in chunked(buffer) {
            postUnicode(chunk)
            usleep(betweenEventsDelay)
        }
        buffer = ""
    }

    /// Quebra por *Character* (não por UTF-16) para nunca partir um par
    /// substituto no meio — emoji e acentuação chegam inteiros.
    private func chunked(_ text: String) -> [[UniChar]] {
        var chunks: [[UniChar]] = []
        var current: [UniChar] = []

        for character in text {
            let units = Array(String(character).utf16)
            if !current.isEmpty, current.count + units.count > maxUnitsPerEvent {
                chunks.append(current)
                current = []
            }
            current.append(contentsOf: units)
        }

        if !current.isEmpty { chunks.append(current) }
        return chunks
    }

    // MARK: - Teclas e atalhos

    private func press(key: String, modifiers: [Modifier]) {
        guard let keyCode = keyCode(for: key) else {
            Log.warn("tecla desconhecida, ignorando: \(key)")
            return
        }

        let flags = modifiers.reduce(into: CGEventFlags()) { $0.insert($1.eventFlag) }
        post(keyCode: keyCode, flags: flags)
    }

    private func keyCode(for key: String) -> CGKeyCode? {
        if let named = KeyCodes.named[key.lowercased()] {
            return named
        }

        guard key.count == 1, let character = key.first else { return nil }
        if let code = characterKeyCodes[character] { return code }

        // ⌘C chega como "C" maiúsculo em muitos teclados de iOS; o keycode é
        // o mesmo da minúscula (o shift vira flag, não outra tecla).
        guard let lowercased = String(character).lowercased().first else { return nil }
        return characterKeyCodes[lowercased]
    }

    // MARK: - CGEvent

    private func post(keyCode: CGKeyCode, flags: CGEventFlags) {
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false)
        else {
            Log.warn("não foi possível criar o evento para o keycode \(keyCode)")
            return
        }

        down.flags = flags
        up.flags = flags

        down.post(tap: .cghidEventTap)
        usleep(pressDelay)
        up.post(tap: .cghidEventTap)
    }

    private func postUnicode(_ units: [UniChar]) {
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
        else {
            Log.warn("não foi possível criar o evento de texto")
            return
        }

        var buffer = units
        down.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: &buffer)
        up.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: &buffer)

        down.post(tap: .cghidEventTap)
        usleep(pressDelay)
        up.post(tap: .cghidEventTap)
    }
}
