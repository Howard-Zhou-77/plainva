import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let io = DispatchQueue(label: "com.plainva.share-extension")
    private let stateLock = NSLock()
    private var cancelled = false, started = false, saved = false
    private let status = UILabel(), spinner = UIActivityIndicatorView(style: .medium)
    private let closeButton = UIButton(type: .system)
    private func copy(_ key: String) -> String { NSLocalizedString(key, tableName: "ShareCopy", comment: "") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let title = UILabel(); title.text = "Plainva"; title.font = .preferredFont(forTextStyle: .title2)
        status.font = .preferredFont(forTextStyle: .body); status.numberOfLines = 0; status.adjustsFontForContentSizeCategory = true
        title.adjustsFontForContentSizeCategory = true
        status.text = copy("receiving")
        closeButton.setTitle(copy("cancel"), for: .normal)
        closeButton.addTarget(self, action: #selector(closeSheet), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [title, status, spinner, closeButton])
        stack.axis = .vertical; stack.spacing = 20; stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            stack.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor)
        ])
        spinner.startAnimating()
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !started else { return }; started = true
        let items = extensionContext?.inputItems.compactMap { $0 as? NSExtensionItem } ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        let subject = items.compactMap { $0.attributedTitle?.string }.first ?? ""
        io.async {
            do {
                guard !providers.isEmpty, providers.count <= 10 else { throw ShareQueueFailure.type }
                let store = try ShareQueueStore(), id = try store.begin(subject: subject)
                self.collect(providers, at: 0, store: store, id: id)
            } catch { self.showFailure(error) }
        }
    }
    private func isCancelled() -> Bool { stateLock.lock(); defer { stateLock.unlock() }; return cancelled }
    @objc private func closeSheet() {
        if saved { extensionContext?.completeRequest(returningItems: nil) }
        else {
            stateLock.lock(); cancelled = true; stateLock.unlock()
            extensionContext?.cancelRequest(withError: ShareQueueFailure.incomplete)
        }
    }
    private func showFailure(_ error: Error) {
        DispatchQueue.main.async {
            self.spinner.stopAnimating()
            self.status.text = self.copy(error as? ShareQueueFailure == .limit ? "limit" : error as? ShareQueueFailure == .full ? "full" : "failed")
            self.closeButton.setTitle(self.copy("close"), for: .normal)
        }
    }
    private func collect(_ providers: [NSItemProvider], at index: Int, store: ShareQueueStore, id: String) {
        if isCancelled() { try? store.failStaging(id, code: "SHARE_INTERRUPTED"); return }
        guard index < providers.count else {
            do {
                try store.finishStaging(id)
                DispatchQueue.main.async {
                    self.saved = true; self.spinner.stopAnimating()
                    self.status.text = self.copy("saved")
                    self.closeButton.setTitle(self.copy("done"), for: .normal)
                }
            } catch { try? store.failStaging(id, code: "SHARE_STORAGE"); showFailure(error) }
            return
        }
        let provider = providers[index]
        // Copy provider-owned file URLs before their callback returns. The OS
        // removes a loadFileRepresentation temporary file at that boundary.
        let advance: (Result<Void, Error>) -> Void = { result in
            self.io.async {
                switch result {
                case .success: self.collect(providers, at: index + 1, store: store, id: id)
                case .failure(let error):
                    try? store.failStaging(id, code: (error as? ShareQueueFailure)?.rawValue ?? "SHARE_INCOMPLETE")
                    self.showFailure(error)
                }
            }
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) || provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            let identifier = provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) ? UTType.fileURL.identifier : UTType.url.identifier
            provider.loadItem(forTypeIdentifier: identifier) { item, error in
                do {
                    if let error { throw error }
                    guard let url = item as? URL else { throw ShareQueueFailure.type }
                    if url.isFileURL {
                        try store.appendFile(id, source: url, name: url.lastPathComponent, mime: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream")
                    } else { try store.appendText(id, text: url.absoluteString) }
                    advance(.success(()))
                } catch { advance(.failure(error)) }
            }
        } else if provider.hasItemConformingToTypeIdentifier(UTType.text.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.text.identifier) { item, error in
                do {
                    if let error { throw error }
                    guard let text = (item as? String) ?? (item as? NSAttributedString)?.string else { throw ShareQueueFailure.type }
                    try store.appendText(id, text: text); advance(.success(()))
                } catch { advance(.failure(error)) }
            }
        } else if let identifier = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .data) == true }) {
            provider.loadFileRepresentation(forTypeIdentifier: identifier) { url, error in
                do {
                    if let error { throw error }; guard let url else { throw ShareQueueFailure.type }
                    var name = provider.suggestedName ?? url.lastPathComponent
                    if (name as NSString).pathExtension.isEmpty, let ext = UTType(identifier)?.preferredFilenameExtension { name += "." + ext }
                    try store.appendFile(id, source: url, name: name, mime: UTType(identifier)?.preferredMIMEType ?? "application/octet-stream")
                    advance(.success(()))
                } catch { advance(.failure(error)) }
            }
        } else { advance(.failure(ShareQueueFailure.type)) }
    }
}
