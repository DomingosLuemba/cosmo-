import Foundation

@MainActor
final class PendingApprovalStore: ObservableObject {
    static let shared = PendingApprovalStore()

    @Published private(set) var approvals: [PendingApproval] = []

    func refresh(deviceId: String) async {
        do {
            approvals = try await BackendClient.shared.fetchPendingApprovals(deviceId: deviceId)
        } catch {
            print("[PendingApprovalStore] falha ao buscar aprovações: \(error)")
        }
    }

    func decide(_ approval: PendingApproval, approved: Bool) async {
        do {
            try await BackendClient.shared.decideApproval(approvalId: approval.id, approved: approved)
            approvals.removeAll { $0.id == approval.id }
        } catch {
            print("[PendingApprovalStore] falha ao registrar decisão: \(error)")
        }
    }
}
