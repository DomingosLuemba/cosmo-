import ApplicationServices
import Foundation

/// O macOS só entrega eventos sintéticos de teclado de um processo autorizado
/// em Ajustes → Privacidade e Segurança → Acessibilidade. Sem isso o CGEvent
/// é criado sem erro e descartado em silêncio — daí a checagem explícita
/// antes de conectar, para não ficar "digitando no vazio".
enum AccessibilityPermission {
    static var isGranted: Bool {
        AXIsProcessTrusted()
    }

    /// Abre o prompt do sistema (uma vez por processo não autorizado) e
    /// devolve se a permissão já vale agora.
    @discardableResult
    static func request() -> Bool {
        let options = [
            kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true
        ] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    static let instructions = """
    O agente precisa de permissão de Acessibilidade para digitar no Mac.

      1. Abra Ajustes do Sistema → Privacidade e Segurança → Acessibilidade.
      2. Ligue a chave do app de onde você rodou este comando
         (Terminal, iTerm, Ghostty, VS Code…). Rodando via `swift run`, quem
         aparece na lista é o terminal, não o "cosmo-mac-agent".
      3. Rode o agente de novo.

    Se o terminal já estiver na lista mas desligado, ligue a chave; se estiver
    ligado e ainda assim não funcionar, desligue e ligue de novo (o macOS
    invalida a autorização quando o binário muda).
    """
}
