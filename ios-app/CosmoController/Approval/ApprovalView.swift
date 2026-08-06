import SwiftUI

/// Tela de confirmação para ações sensíveis (assinaturas, compras, exclusão
/// de dados, mensagens etc — ver docs/POLICY.md). Nada nessa lista executa
/// sem o usuário tocar em "Aprovar" aqui.
struct ApprovalView: View {
    @ObservedObject var store: PendingApprovalStore
    let deviceId: String

    var body: some View {
        NavigationStack {
            List {
                if store.approvals.isEmpty {
                    Text("Nenhuma aprovação pendente.")
                        .foregroundStyle(.secondary)
                }
                ForEach(store.approvals) { approval in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(approval.action.toolName)
                            .font(.headline)
                        Text(approval.reason)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        HStack {
                            Button("Negar", role: .destructive) {
                                Task { await store.decide(approval, approved: false) }
                            }
                            Spacer()
                            Button("Aprovar") {
                                Task { await store.decide(approval, approved: true) }
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("Aprovações")
            .task { await store.refresh(deviceId: deviceId) }
            .refreshable { await store.refresh(deviceId: deviceId) }
        }
    }
}
