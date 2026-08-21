import SwiftUI

/// Aba "Teclado": pareia com o Mac e transforma o iPhone num teclado dele.
struct RemoteKeyboardView: View {
    @StateObject private var client = MacKeyboardClient.shared

    @State private var pairingCode = ""
    @State private var isCapturing = false
    /// Modificadores valem para a *próxima* tecla e depois se soltam — como
    /// as teclas presas do acesso assistido. Sem isso seria preciso segurar
    /// duas teclas ao mesmo tempo numa tela sensível ao toque.
    @State private var stickyModifiers: Set<MacModifier> = []

    var body: some View {
        NavigationStack {
            Group {
                if client.isPaired {
                    keyboard
                } else {
                    pairingForm
                }
            }
            .navigationTitle("Teclado")
        }
        .task { await client.refreshStatus() }
    }

    // MARK: - Pareamento

    private var pairingForm: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Digitar no Mac pelo iPhone")
                .font(.title2.bold())

            Text("""
            No Mac, rode o agente:

                cd mac-agent
                swift run cosmo-mac-agent --backend <url do backend>

            Ele mostra um código de 6 dígitos. Digite aqui:
            """)
            .font(.callout)
            .foregroundStyle(.secondary)

            TextField("000000", text: $pairingCode)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.numberPad)
                .font(.system(.title, design: .monospaced))
                .multilineTextAlignment(.center)

            Button("Parear") {
                Task {
                    await client.pair(code: pairingCode)
                    pairingCode = ""
                }
            }
            .buttonStyle(.borderedProminent)
            .frame(maxWidth: .infinity)
            .disabled(pairingCode.filter(\.isNumber).count != 6)

            if !client.statusMessage.isEmpty {
                Text(client.statusMessage)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Spacer()
        }
        .padding()
    }

    // MARK: - Teclado

    private var keyboard: some View {
        VStack(spacing: 16) {
            status

            captureSurface

            modifierRow

            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    KeyButton("esc") { sendKey("escape") }
                    KeyButton("tab") { sendKey("tab") }
                    KeyButton("⌫") { sendKey("delete") }
                    KeyButton("⏎") { sendKey("return") }
                }
                HStack(spacing: 8) {
                    KeyButton("←") { sendKey("left") }
                    KeyButton("↓") { sendKey("down") }
                    KeyButton("↑") { sendKey("up") }
                    KeyButton("→") { sendKey("right") }
                }
                HStack(spacing: 8) {
                    KeyButton("⌘C") { sendKey("c", modifiers: [.command]) }
                    KeyButton("⌘V") { sendKey("v", modifiers: [.command]) }
                    KeyButton("⌘X") { sendKey("x", modifiers: [.command]) }
                    KeyButton("⌘Z") { sendKey("z", modifiers: [.command]) }
                }
            }

            Spacer()

            Button("Desconectar do Mac", role: .destructive) {
                isCapturing = false
                Task { await client.unpair() }
            }
            .font(.footnote)
        }
        .padding()
    }

    private var status: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(client.isOnline ? Color.green : Color.orange)
                .frame(width: 8, height: 8)

            Text(client.statusMessage.isEmpty
                 ? (client.pairing?.agentName ?? "Mac")
                 : client.statusMessage)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            Spacer()

            Button("Atualizar") {
                Task { await client.refreshStatus() }
            }
            .font(.footnote)
        }
    }

    private var captureSurface: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(isCapturing ? Color.accentColor : Color.secondary.opacity(0.4),
                              lineWidth: isCapturing ? 2 : 1)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.secondary.opacity(0.08)))

            KeyCaptureView(
                isCapturing: $isCapturing,
                onText: sendText,
                onKey: { sendKey($0) }
            )

            Text(isCapturing
                 ? "Digitando no Mac… o texto não aparece aqui."
                 : "Toque para abrir o teclado e digitar no Mac.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding()
                .allowsHitTesting(false)
        }
        .frame(height: 110)
    }

    private var modifierRow: some View {
        HStack(spacing: 8) {
            ForEach(MacModifier.allCases) { modifier in
                Button {
                    if stickyModifiers.contains(modifier) {
                        stickyModifiers.remove(modifier)
                    } else {
                        stickyModifiers.insert(modifier)
                    }
                } label: {
                    Text(modifier.symbol)
                        .frame(maxWidth: .infinity, minHeight: 40)
                }
                .buttonStyle(.bordered)
                .tint(stickyModifiers.contains(modifier) ? Color.accentColor : Color.secondary)
            }
        }
    }

    // MARK: - Envio

    private func sendText(_ text: String) {
        guard stickyModifiers.isEmpty else {
            // Com modificador ligado, a letra vira atalho: "c" + ⌘ = ⌘C.
            sendKey(text, modifiers: Array(stickyModifiers))
            return
        }
        client.typeText(text)
    }

    private func sendKey(_ key: String, modifiers: [MacModifier] = []) {
        let combined = modifiers.isEmpty ? Array(stickyModifiers) : modifiers
        client.pressKey(key, modifiers: combined)
        stickyModifiers.removeAll()
    }
}

private struct KeyButton: View {
    let label: String
    let action: () -> Void

    init(_ label: String, action: @escaping () -> Void) {
        self.label = label
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(.body, design: .rounded))
                .frame(maxWidth: .infinity, minHeight: 44)
        }
        .buttonStyle(.bordered)
    }
}
