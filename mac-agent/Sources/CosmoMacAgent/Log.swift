import Foundation

/// Saída de terminal do agente. Fica separada porque o código de pareamento
/// precisa ser impossível de perder no meio do log.
enum Log {
    static func info(_ message: String) {
        print("[cosmo] \(message)")
    }

    static func warn(_ message: String) {
        print("[cosmo] aviso: \(message)")
    }

    static func error(_ message: String) {
        FileHandle.standardError.write(Data("[cosmo] erro: \(message)\n".utf8))
    }

    static func pairingCode(_ code: String) {
        // Dígitos separados para facilitar copiar olhando pro teclado do iPhone.
        let spaced = code.map(String.init).joined(separator: " ")
        let lines = [
            "Código de pareamento:  \(spaced)",
            "Digite no app Cosmo → aba Teclado. Vale por 5 minutos.",
        ]

        // Moldura calculada, não fixa: o texto muda e o desenho tem que seguir.
        let width = (lines.map(\.count).max() ?? 0) + 2
        let border = String(repeating: "─", count: width)

        print("")
        print("┌\(border)┐")
        for line in lines {
            let padding = String(repeating: " ", count: width - line.count - 1)
            print("│ \(line)\(padding)│")
        }
        print("└\(border)┘")
        print("")
    }
}
