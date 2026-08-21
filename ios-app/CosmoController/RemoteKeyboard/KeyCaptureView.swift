import SwiftUI
import UIKit

/// Superfície que recebe, caractere a caractere, o que você digita no teclado
/// do iPhone — e repassa para o Mac.
///
/// Um `TextField` comum não serve aqui: ele entrega o texto já acumulado e
/// corrigido, então não dá para saber *qual* tecla foi apertada, nem separar
/// um backspace de uma edição no meio da palavra. `UIKeyInput` entrega os
/// eventos crus, que é o que o Mac precisa reproduzir.
struct KeyCaptureView: UIViewRepresentable {
    @Binding var isCapturing: Bool
    let onText: (String) -> Void
    let onKey: (String) -> Void

    func makeUIView(context: Context) -> KeyCaptureUIView {
        KeyCaptureUIView()
    }

    func updateUIView(_ view: KeyCaptureUIView, context: Context) {
        // Reatribuídos a cada update para os closures nunca ficarem presos a
        // um estado velho da view.
        view.onText = onText
        view.onKey = onKey
        view.onCaptureStarted = { isCapturing = true }
        view.onCaptureEnded = { isCapturing = false }

        if isCapturing, !view.isFirstResponder {
            view.becomeFirstResponder()
        } else if !isCapturing, view.isFirstResponder {
            view.resignCapture()
        }
    }
}

final class KeyCaptureUIView: UIView, UIKeyInput {
    var onText: ((String) -> Void)?
    var onKey: ((String) -> Void)?
    /// Disparado pelo toque na superfície.
    var onCaptureStarted: (() -> Void)?
    /// Disparado quando o teclado é fechado pelo usuário (não por nós).
    var onCaptureEnded: (() -> Void)?

    private var isResigningProgrammatically = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        // O toque é tratado aqui, e não com `.onTapGesture` no SwiftUI: uma
        // UIView interativa vence o hit test e o gesto do SwiftUI nunca
        // chegaria a rodar.
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(handleTap)))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) não é usado — a view é criada por KeyCaptureView.")
    }

    override var canBecomeFirstResponder: Bool { true }

    /// Sempre `true` para o teclado manter a tecla de apagar ativa — não
    /// guardamos texto nenhum aqui, cada tecla é repassada na hora.
    var hasText: Bool { true }

    // Nada de autocorreção, capitalização automática ou aspas inteligentes:
    // o que você toca é exatamente o que chega no Mac.
    var autocorrectionType: UITextAutocorrectionType = .no
    var autocapitalizationType: UITextAutocapitalizationType = .none
    var spellCheckingType: UITextSpellCheckingType = .no
    var smartQuotesType: UITextSmartQuotesType = .no
    var smartDashesType: UITextSmartDashesType = .no
    var smartInsertDeleteType: UITextSmartInsertDeleteType = .no

    func insertText(_ text: String) {
        // A tecla de retorno chega como "\n"; no Mac ela precisa ser um
        // Return de verdade, não o caractere.
        if text == "\n" {
            onKey?("return")
        } else {
            onText?(text)
        }
    }

    func deleteBackward() {
        onKey?("delete")
    }

    /// Fecha o teclado sem disparar `onCaptureEnded` — usado quando é a
    /// própria UI que está desligando a captura, para não virar loop.
    func resignCapture() {
        isResigningProgrammatically = true
        resignFirstResponder()
        isResigningProgrammatically = false
    }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned, !isResigningProgrammatically {
            onCaptureEnded?()
        }
        return resigned
    }

    @objc private func handleTap() {
        becomeFirstResponder()
        onCaptureStarted?()
    }
}
