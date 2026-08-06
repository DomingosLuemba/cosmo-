import SwiftUI

struct ContentView: View {
    @StateObject private var approvalStore = PendingApprovalStore.shared
    @State private var commandText = ""
    @State private var lastReply = ""

    var body: some View {
        TabView {
            VStack(spacing: 16) {
                Text(lastReply)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()

                HStack {
                    TextField("Diga o que o Cosmo deve fazer…", text: $commandText)
                        .textFieldStyle(.roundedBorder)
                    Button("Enviar") { Task { await sendCommand() } }
                        .disabled(commandText.isEmpty)
                }
                .padding()

                Spacer()
            }
            .tabItem { Label("Cosmo", systemImage: "sparkles") }

            ApprovalView(store: approvalStore, deviceId: CurrentUser.deviceId)
                .tabItem { Label("Aprovações", systemImage: "checkmark.shield") }
        }
    }

    private func sendCommand() async {
        do {
            let response = try await BackendClient.shared.sendCommand(
                userId: CurrentUser.id,
                deviceId: CurrentUser.deviceId,
                deviceToken: CurrentUser.deviceToken,
                text: commandText
            )
            lastReply = response.reply
            commandText = ""
            await approvalStore.refresh(deviceId: CurrentUser.deviceId)
        } catch {
            lastReply = "Erro ao falar com o backend: \(error)"
        }
    }
}
