import { parseWorkspaceDocument, verifyWorkspaceDocumentSignatures, type WorkspaceOperationPayload, type WorkspacePolicyPayload, type WorkspaceSignedDocument } from "./documents.js";
import { decodeBase64Exact, fromBase64, sha256Hex } from "./encoding.js";
import { protocolAssert } from "./errors.js";
import type { WorkspaceObjectStore } from "./objectStore.js";
import type { WorkspaceStateStore } from "./state.js";

/** Restore byte-identical signed copies, never mint a replacement or move a head. */
export async function restoreKnownOperationCopies(input: {
  state: WorkspaceStateStore;
  store: WorkspaceObjectStore;
  workspaceId: string;
  policies: ReadonlyMap<string, WorkspacePolicyPayload>;
  listedKeys: ReadonlySet<string>;
  signal?: AbortSignal;
}): Promise<{ restored: number; unavailable: number }> {
  const meta = await input.state.loadMeta();
  protocolAssert(meta?.workspaceId === input.workspaceId, "integrity", "workspace recovery state binding mismatch");
  let restored = 0, unavailable = 0;
  for (const [deviceId, head] of Object.entries(meta.operationHeads)) {
    let expectedHash: string | null = head.operationHash;
    let expectedSequence = head.sequence;
    const copies: Array<{ key: string; bytes: Uint8Array; hash: string }> = [];
    const seen = new Set<string>();
    while (expectedHash !== null) {
      if (input.signal?.aborted) throw new DOMException("Workspace recovery aborted", "AbortError");
      protocolAssert(seen.size < 20_000 && !seen.has(expectedHash), "bounds", "workspace recovery chain exceeds the inspection limit");
      seen.add(expectedHash);
      const local = await input.state.getOperationDocument(expectedHash);
      if (!local) { unavailable++; break; }
      const bytes = fromBase64(local);
      protocolAssert(sha256Hex(bytes) === expectedHash, "integrity", "local recovery operation hash mismatch");
      const parsed = parseWorkspaceDocument(bytes);
      protocolAssert(parsed.kind === "operation" && parsed.workspaceId === input.workspaceId, "integrity", "local recovery operation binding mismatch");
      const document = parsed as WorkspaceSignedDocument<"operation", WorkspaceOperationPayload>;
      protocolAssert(document.payload.deviceId === deviceId && document.payload.sequence === expectedSequence, "integrity", "local recovery operation chain mismatch");
      const policy = input.policies.get(document.payload.policyHash);
      const device = policy?.devices.find(candidate => candidate.deviceId === deviceId && candidate.memberId === document.payload.memberId && candidate.state === "active");
      protocolAssert(!!device && verifyWorkspaceDocumentSignatures(document, entry => entry.signerId === deviceId ? decodeBase64Exact(device.signingPublicKey, 32, "recovery signing key") : null), "crypto", "local recovery operation signature verification failed");
      const key = `.pvws/operations/${deviceId}/${expectedSequence}-${expectedHash}.pvop`;
      if (!input.listedKeys.has(key)) copies.push({ key, bytes, hash: expectedHash });
      expectedHash = document.payload.previousDeviceOperationHash;
      expectedSequence--;
    }
    // An incomplete copy cannot establish a chain. Keep every trust anchor.
    if (expectedHash !== null) continue;
    protocolAssert(expectedSequence === 0, "integrity", "local recovery chain does not reach its origin");
    for (const copy of copies.reverse()) {
      await input.store.putImmutable(copy.key, copy.bytes, copy.hash, { signal: input.signal });
      restored++;
    }
  }
  return { restored, unavailable };
}
