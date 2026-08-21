import Carbon
import CoreGraphics
import Foundation

/// Virtual keycodes do macOS.
///
/// Os keycodes de teclas nomeadas (`kVK_*` do Carbon.HIToolbox) são fixos e
/// não dependem do layout — `kVK_Return` é 0x24 tanto em ABNT2 quanto em US.
/// Já os caracteres mudam de posição por layout, por isso o mapa de
/// caracteres é montado em tempo de execução a partir do layout ativo.
enum KeyCodes {
    static let returnKey: CGKeyCode = 0x24
    static let tab: CGKeyCode = 0x30

    /// Nomes aceitos em `{ "type": "key", "key": "<nome>" }`.
    /// Precisa bater com `NAMED_KEYS` em `backend/src/types/keyboard.ts`.
    static let named: [String: CGKeyCode] = [
        "return": 0x24,        // kVK_Return
        "enter": 0x4C,         // kVK_ANSI_KeypadEnter
        "tab": 0x30,           // kVK_Tab
        "space": 0x31,         // kVK_Space
        "delete": 0x33,        // kVK_Delete (backspace)
        "forwarddelete": 0x75, // kVK_ForwardDelete
        "escape": 0x35,        // kVK_Escape
        "left": 0x7B,          // kVK_LeftArrow
        "right": 0x7C,         // kVK_RightArrow
        "down": 0x7D,          // kVK_DownArrow
        "up": 0x7E,            // kVK_UpArrow
        "home": 0x73,          // kVK_Home
        "end": 0x77,           // kVK_End
        "pageup": 0x74,        // kVK_PageUp
        "pagedown": 0x79,      // kVK_PageDown
        "f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76,
        "f5": 0x60, "f6": 0x61, "f7": 0x62, "f8": 0x64,
        "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F,
    ]

    /// Mapa caractere → keycode do layout ativo (ABNT2, US, Dvorak…).
    ///
    /// Só é usado para atalhos, onde o keycode físico é o que importa: ⌘C
    /// precisa ser a tecla que produz "c" *neste* teclado. Digitação normal
    /// não passa por aqui — vai como string Unicode, que ignora o layout.
    static func currentLayoutCharacterMap() -> [Character: CGKeyCode] {
        guard let inputSource = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
              let layoutPointer = TISGetInputSourceProperty(inputSource, kTISPropertyUnicodeKeyLayoutData)
        else {
            return [:]
        }

        let layoutData = Unmanaged<CFData>.fromOpaque(layoutPointer).takeUnretainedValue() as Data
        let keyboardType = UInt32(LMGetKbdType())
        var map: [Character: CGKeyCode] = [:]

        layoutData.withUnsafeBytes { rawBuffer in
            guard let layout = rawBuffer.bindMemory(to: UCKeyboardLayout.self).baseAddress else { return }

            for keyCode in UInt16(0)..<UInt16(128) {
                var deadKeyState: UInt32 = 0
                var characters = [UniChar](repeating: 0, count: 4)
                var length = 0

                let status = UCKeyTranslate(
                    layout,
                    keyCode,
                    UInt16(kUCKeyActionDisplay),
                    0, // sem modificadores: queremos o caractere base da tecla
                    keyboardType,
                    OptionBits(kUCKeyTranslateNoDeadKeysMask),
                    &deadKeyState,
                    characters.count,
                    &length,
                    &characters
                )

                guard status == noErr, length > 0 else { continue }
                let produced = String(utf16CodeUnits: characters, count: length)
                guard let character = produced.first, !character.isWhitespace else { continue }
                // Primeiro keycode que produz o caractere vence (o teclado
                // numérico tem keycodes maiores e não deve sobrescrever a
                // fileira de números).
                if map[character] == nil {
                    map[character] = CGKeyCode(keyCode)
                }
            }
        }

        return map
    }
}
