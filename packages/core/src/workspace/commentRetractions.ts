import { evaluateWorkspaceAccess } from "./authorization.js";
import { parseWorkspaceDocument, verifyWorkspaceDocumentSignatures, workspaceDocumentHash, type WorkspaceOperationPayload, type WorkspacePolicyPayload } from "./documents.js";
import { decodeBase64Exact, fromBase64 } from "./encoding.js";
import type { WorkspaceStateStore } from "./state.js";

/** Rebuild moderation from accepted immutable markers. The marker may arrive
 * before its target, or have been accepted by an older client that missed it.
 * Authority comes from the marker's accepted policy, never today's role and
 * never a sender-controlled flag in its body. No sealed history is rewritten. */
export async function reconcileWorkspaceCommentRetractions(input: {
  state: WorkspaceStateStore;
  workspaceId: string;
  policies: ReadonlyMap<string, WorkspacePolicyPayload>;
  signal?: AbortSignal;
}): Promise<string[]> {
  const records = await input.state.listRawComments(), byId = new Map(records.map(record => [record.commentId, record]));
  const changed = new Set<string>();
  for (const marker of records) {
    if (input.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (!marker.retractsCommentId || marker.legacyOrigin || !marker.operationHash) continue;
    const target = byId.get(marker.retractsCommentId);
    if (!target || target.targetObjectId !== marker.targetObjectId || target.commentId === marker.commentId) continue;
    if (target.retractedAt && target.retractedAt <= marker.createdAt) continue;
    const encoded = await input.state.getOperationDocument(marker.operationHash);
    if (!encoded) continue; // Recovery may restore a missing observed copy later.
    let allowed: boolean;
    try {
      const document = parseWorkspaceDocument(fromBase64(encoded));
      if (document.kind !== "operation" || document.workspaceId !== input.workspaceId || workspaceDocumentHash(document) !== marker.operationHash) continue;
      const op = document.payload as WorkspaceOperationPayload;
      if (op.operation !== "comment" || op.objectId !== marker.commentId || op.payloadHash !== marker.payloadHash
        || op.memberId !== marker.authorMemberId || op.deviceId !== marker.authorDeviceId || op.createdAt !== marker.createdAt) continue;
      const policy = input.policies.get(op.policyHash);
      if (!policy) continue;
      const device = policy.devices.find(entry => entry.deviceId === op.deviceId && entry.memberId === op.memberId);
      if (!device || !verifyWorkspaceDocumentSignatures(document, signature => signature.signerId === device.deviceId
        ? decodeBase64Exact(device.signingPublicKey, 32, "moderator signing key") : null)) continue;
      allowed = evaluateWorkspaceAccess(policy, { memberId: op.memberId, deviceId: op.deviceId, capability: "workspace.manage" }).allowed;
    } catch { continue; }
    if (!allowed) continue;
    // Persist before announcing a change. Replaying a marker does no new write.
    await input.state.retractComment(target.commentId, marker.createdAt);
    target.retractedAt = marker.createdAt;
    changed.add(target.targetObjectId);
  }
  return [...changed].sort();
}
