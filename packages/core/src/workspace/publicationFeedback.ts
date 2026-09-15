import { projectCommentRecords } from "../comments/commentProjection.js";
import { sha256Hex, utf8Encode } from "./encoding.js";
import type { PublicationComment } from "./publication.js";
import type { WorkspaceCommentRecord } from "./state.js";

/** A review in the source vault must not collide with a local comment, or with
 * the same recipient-generated ID in another independent publication. This is
 * a view identity only: remote signed objects are never changed or re-sealed. */
export function publicationReviewCommentId(publicationId: string, commentId: string): string {
  return sha256Hex(utf8Encode(JSON.stringify(["plainva-publication-review-v1", publicationId, commentId]))).slice(0, 32);
}

/** The owner's decisions stay in the original note's authenticated comment
 * ledger. Its normal durable text/marker transaction can therefore apply a
 * proposal without a second network write between saving and acknowledging.
 * This records the review in the source vault; it does not claim to send an
 * answer into the independent recipient workspace. */
export function projectPublicationFeedbackForOwner<T extends PublicationComment>(
  entries: readonly T[], localRecords: readonly WorkspaceCommentRecord[],
): T[] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const list = groups.get(entry.publicationId) ?? [];
    list.push(entry); groups.set(entry.publicationId, list);
  }
  const result: T[] = [];
  for (const [publicationId, group] of groups) {
    const id = (value: string) => publicationReviewCommentId(publicationId, value);
    const reference = (value: string) => value.startsWith("legacy:")
      ? `legacy:${sha256Hex(utf8Encode(JSON.stringify([publicationId, value])))}` : id(value);
    const named = new Map<string, T>();
    for (const entry of group) {
      const c = entry.comment;
      const comment: WorkspaceCommentRecord = { ...c, commentId: id(c.commentId),
        parentCommentId: c.parentCommentId ? id(c.parentCommentId) : null,
        resolvedCommentId: c.resolvedCommentId ? id(c.resolvedCommentId) : null,
        retractsCommentId: c.retractsCommentId ? id(c.retractsCommentId) : null,
        suggestionBatchId: c.suggestionBatchId ? id(c.suggestionBatchId) : null,
        ...(c.suggestionDecision ? { suggestionDecision: { ...c.suggestionDecision,
          knownIds: c.suggestionDecision.knownIds.map(reference),
          decisions: c.suggestionDecision.decisions.map(fact => ({ ...fact, id: reference(fact.id),
            ...(fact.proof ? { proof: { ...fact.proof, supersedes: fact.proof.supersedes.map(reference) } } : {}) })) } } : {}),
        ...(c.decisionProof ? { decisionProof: { ...c.decisionProof,
          supersedes: c.decisionProof.supersedes.map(reference) } } : {}) };
      named.set(comment.commentId, { ...entry, comment });
    }
    const decisions = localRecords.filter(record => record.resolvedCommentId && !record.legacyOrigin
      && named.get(record.resolvedCommentId)?.comment.targetObjectId === record.targetObjectId);
    for (const comment of projectCommentRecords([...named.values()].map(entry => entry.comment).concat(decisions))) {
      const original = named.get(comment.commentId);
      if (original) result.push({ ...original, comment });
    }
  }
  return result;
}
