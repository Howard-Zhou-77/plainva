import Foundation

@main
struct ShareQueueTests {
    static func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        if !condition() { throw NSError(domain: message, code: 1) }
    }
    static func main() throws {
        let fm = FileManager.default
        if CommandLine.arguments.count > 2 {
            let store = try ShareQueueStore(root: URL(fileURLWithPath: CommandLine.arguments[2]))
            if CommandLine.arguments[1] == "--begin" { print(try store.begin(subject: "Interrupted")); return }
            if CommandLine.arguments[1] == "--append" {
                for i in 0..<10 { try store.appendText(CommandLine.arguments[3], text: "\(ProcessInfo.processInfo.processIdentifier)-\(i)") }; return
            }
        }
        let scratch = fm.temporaryDirectory.appendingPathComponent("plainva-share-tests-" + UUID().uuidString, isDirectory: true)
        try fm.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: scratch) }
        let root = scratch.appendingPathComponent("inbox"), store = try ShareQueueStore(root: root)
        let first = try store.begin(subject: "Agenda"), second = try store.begin(subject: "Agenda")
        try require(first != second, "explicit equal-content transfers need different IDs")
        try store.appendText(first, text: "https://example.test/agenda")
        let source = scratch.appendingPathComponent("file.bin"), bytes = Data(repeating: 72, count: 300_000)
        try bytes.write(to: source)
        try store.appendFile(first, source: source, name: "../drawing.bin", mime: "application/octet-stream")
        try store.finishStaging(first)
        let reopened = try ShareQueueStore(root: root)
        let entry = try reopened.list().first { $0["id"] as? String == first }!
        let file = (entry["files"] as! [[String: Any]])[0], fileId = file["id"] as! String
        let chunk = try reopened.chunk(first, fileId: fileId, offset: 0, length: ShareQueueStore.chunkLimit)
        try require(Data(base64Encoded: chunk)!.count == ShareQueueStore.chunkLimit, "bounded file read")
        do { try reopened.finish(first, discard: false); throw NSError(domain: "premature acknowledgement", code: 1) } catch ShareQueueFailure.incomplete { }
        let plan: [String: Any] = ["version": 1, "vaultId": "fixture", "notePath": "Inbox/Agenda.md", "noteText": "# Agenda", "files": [["id": fileId, "path": "Attachments/fixture.bin"]]]
        _ = try reopened.beginImport(first, plan: plan)
        let resumed = try reopened.beginImport(first, plan: ["vaultId": "wrong"])
        try require((resumed["plan"] as? [String: Any])?["vaultId"] as? String == "fixture", "first durable target wins")
        try reopened.mark(first, fileId: fileId, note: false)
        try reopened.mark(first, fileId: fileId, note: false)
        try reopened.mark(first, fileId: nil, note: true)
        try reopened.finish(first, discard: false)
        try reopened.finish(first, discard: false)
        try require(!fm.fileExists(atPath: root.appendingPathComponent(first + "/" + fileId + ".bin").path), "acknowledged payload removed")
        let remaining = try reopened.list()
        try require(!remaining.contains { $0["id"] as? String == first }, "completed transfer is not returned")
        do { _ = try reopened.chunk("../escape", fileId: fileId, offset: 0, length: 1); throw NSError(domain: "path escape", code: 1) } catch ShareQueueFailure.invalid { }
        // Four distinct processes append to one manifest, exercising flock.
        var children: [Process] = []
        for _ in 0..<4 {
            let child = Process(); child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0]); child.arguments = ["--append", root.path, second]
            try child.run(); children.append(child)
        }
        for child in children { child.waitUntilExit(); try require(child.terminationStatus == 0, "concurrent writer") }
        let concurrent = try reopened.list().first { $0["id"] as? String == second }!
        try require((concurrent["text"] as! String).split(separator: "\n").count == 40, "no lost cross-process update")
        let orphan = Process(), output = Pipe()
        orphan.executableURL = URL(fileURLWithPath: CommandLine.arguments[0]); orphan.arguments = ["--begin", root.path]; orphan.standardOutput = output
        try orphan.run(); orphan.waitUntilExit()
        let orphanId = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)!.trimmingCharacters(in: .whitespacesAndNewlines)
        let interrupted = try reopened.list().first { $0["id"] as? String == orphanId }!
        try require(interrupted["status"] as? String == "failed", "interrupted staging is visible and unacknowledged")
        try reopened.finish(orphanId, discard: true)
        let missingId = UUID().uuidString.lowercased(), missingFolder = root.appendingPathComponent(missingId)
        try fm.createDirectory(at: missingFolder, withIntermediateDirectories: true)
        let partial = missingFolder.appendingPathComponent("interrupted.bin")
        try Data([1, 2, 3]).write(to: partial)
        let recovered = try reopened.list().first { $0["id"] as? String == missingId }!
        try require(recovered["failure"] as? String == "SHARE_INTERRUPTED" && fm.fileExists(atPath: partial.path), "missing manifest preserves bytes and does not block the queue")
        try reopened.finish(missingId, discard: true)
        try require(!fm.fileExists(atPath: partial.path), "explicit orphan discard removes staged bytes")
        print("Share queue: streaming, atomic target, checkpoints, cleanup, path bounds, four-process race and process-exit recovery passed.")
    }
}
