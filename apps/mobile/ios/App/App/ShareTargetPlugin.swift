import Foundation
import Capacitor

@objc(ShareTargetPlugin)
public class ShareTargetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareTargetPlugin"
    public let jsName = "ShareTarget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "listPendingShares", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFileChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginImport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "markImported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishShare", returnType: CAPPluginReturnPromise)
    ]
    private let io = DispatchQueue(label: "com.plainva.share-inbox")
    private func run(_ call: CAPPluginCall, action: @escaping (ShareQueueStore) throws -> [String: Any]) {
        io.async {
            do { call.resolve(try action(ShareQueueStore())) }
            catch { call.reject((error as? ShareQueueFailure)?.rawValue ?? "SHARE_STORAGE") }
        }
    }
    @objc func listPendingShares(_ call: CAPPluginCall) {
        run(call) { store in ["entries": try store.list()] }
    }
    @objc func readFileChunk(_ call: CAPPluginCall) {
        run(call) { store in
            guard let id = call.getString("id"), let fileId = call.getString("fileId"), let offset = call.getInt("offset"), let length = call.getInt("length") else { throw ShareQueueFailure.invalid }
            return ["data": try store.chunk(id, fileId: fileId, offset: offset, length: length)]
        }
    }
    @objc func beginImport(_ call: CAPPluginCall) {
        run(call) { store in
            guard let id = call.getString("id"), let plan = call.getObject("plan") else { throw ShareQueueFailure.invalid }
            return ["entry": try store.beginImport(id, plan: plan)]
        }
    }
    @objc func markImported(_ call: CAPPluginCall) {
        run(call) { store in
            guard let id = call.getString("id") else { throw ShareQueueFailure.invalid }
            try store.mark(id, fileId: call.getString("fileId"), note: call.getBool("note") ?? false)
            return [:]
        }
    }
    @objc func finishShare(_ call: CAPPluginCall) {
        run(call) { store in
            guard let id = call.getString("id") else { throw ShareQueueFailure.invalid }
            try store.finish(id, discard: call.getBool("discard") ?? false)
            return [:]
        }
    }
}
