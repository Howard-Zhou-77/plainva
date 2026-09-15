// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { CommentsSheet } from "./CommentsSheet";
import type { WorkspaceCommentRecord } from "@plainva/core";
import en from "../../../../packages/ui/src/locales/en.json";

function tr(key: string): string {
  const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en);
  return typeof value === "string" ? value : key;
}

vi.mock("react-i18next", async () => {
  const catalogue = (await import("../../../../packages/ui/src/locales/en.json")).default as Record<string, unknown>;
  const lookup = (key: string): string => {
    const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);
    return typeof value === "string" ? value : key;
  };
  return {
    initReactI18next: { type: "3rdParty", init: () => {} },
    useTranslation: () => ({
      i18n: { language: "en" },
      t: (key: string, vars?: Record<string, string | number>) => {
        const value = lookup(key);
        return vars ? Object.entries(vars).reduce((out, [name, v]) => out.split(`{{${name}}}`).join(String(v)), value) : value;
      },
    }),
  };
});

/**
 * Locked on this phone (Nachschaerfung, N3).
 *
 * Before N3 a locked device saw an empty sheet: "nobody wrote anything" was
 * the reading, and the composer was there to type into - a post would have
 * failed. The sheet has to say what is going on and offer the way out.
 */
describe("the comments sheet, locked", () => {
  it("shows the owner's publication feedback and reviews only an applicable proposal with source rights", async () => {
    const comment: WorkspaceCommentRecord = { commentId: "91".repeat(16), targetObjectId: "92".repeat(16), parentCommentId: null,
      authorMemberId: "reviewer", authorDeviceId: "phone", body: "Please clarify", anchor: null, resolvedCommentId: null, resolvedAt: null,
      createdAt: "2026-09-15T08:00:00.000Z", suggestion: { replacement: "New words", appliedAt: null, appliedBy: null, declinedAt: null } };
    const entry = { comment, publicationId: "93".repeat(16), publicationName: "External review", path: "note.md", authorDisplayName: "Reviewer", authorActive: true, suggestionApplicable: true };
    const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
    const onApplySuggestion = vi.fn(), onDeclineSuggestion = vi.fn();
    const props = { comments: [], publicationComments: [entry], memberNames: new Map<string, string>(), selfMemberId: "owner",
      canComment: true, canWrite: true, onSubmit: async () => {}, onResolve: () => {}, onApplySuggestion, onDeclineSuggestion,
      onPromoteToTask: () => {}, onRevealAnchor: () => {}, onClose: () => {} };
    await act(async () => { root.render(<CommentsSheet {...props} />); });
    expect(host.textContent).toContain("External review");
    expect(host.textContent).toContain("Reviewer");
    expect(host.querySelector(".pv-comment-column__empty")).toBeNull();
    const section = host.querySelector(".pv-comment-returns")!;
    await act(async () => { [...section.querySelectorAll("button")].find(button => button.textContent === tr("comments.suggestionApply"))!.click(); });
    expect(onApplySuggestion).toHaveBeenCalledWith(comment);
    await act(async () => { root.render(<CommentsSheet {...props} publicationComments={[{ ...entry, suggestionApplicable: false }]} />); });
    expect([...section.querySelectorAll("button")].some(button => button.textContent === tr("comments.suggestionApply"))).toBe(false);
    await act(async () => { root.render(<CommentsSheet {...props} canWrite={false} canComment={false} />); });
    expect(section.querySelectorAll("button")).toHaveLength(0);
    await act(async () => { root.unmount(); }); host.remove();
  });
  it("shows conflicting decisions with the same explicit review action as desktop", async () => {
    const proposal: WorkspaceCommentRecord = { commentId: "ab".repeat(16), targetObjectId: "note.md", parentCommentId: null,
      authorMemberId: "phone", authorDeviceId: "phone", body: "Proposal", anchor: null, resolvedCommentId: null, resolvedAt: null,
      createdAt: "2026-09-09T10:00:00.000Z", suggestion: { replacement: "New words", appliedAt: null, appliedBy: null, declinedAt: null },
      suggestionDecision: { status: "conflict", decisions: [], knownIds: ["ac".repeat(16), "ad".repeat(16)] } };
    const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
    const onReviewDecision = vi.fn();
    await act(async () => { root.render(<CommentsSheet comments={[proposal]} memberNames={new Map([["phone", "Phone"]])} selfMemberId="phone"
      canComment canWrite onSubmit={async () => {}} onResolve={() => {}} onApplySuggestion={() => {}} onDeclineSuggestion={() => {}}
      onPromoteToTask={() => {}} onRevealAnchor={() => {}} onClose={() => {}} onReviewDecision={onReviewDecision} />); });
    const tabs = [...host.querySelectorAll("button")];
    await act(async () => { tabs.find((b) => b.textContent?.startsWith(tr("comments.suggestions")))!.click(); });
    expect(host.textContent).toContain(tr("comments.decisionConflict"));
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.some((b) => b.textContent?.trim() === tr("comments.suggestionApply"))).toBe(false);
    await act(async () => { buttons.find((b) => b.textContent?.trim() === tr("comments.decisionReview"))!.click(); });
    expect(onReviewDecision).toHaveBeenCalledWith(proposal);
    await act(async () => { root.unmount(); }); host.remove();
  });

  it("explains, offers the unlock, and shows no composer", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onUnlock = vi.fn();
    await act(async () => {
      root.render(
        <CommentsSheet
          comments={[]}
          memberNames={new Map()}
          selfMemberId="me"
          canComment
          canWrite
          onSubmit={async () => {}}
          onResolve={() => {}}
          onApplySuggestion={() => {}}
          onDeclineSuggestion={() => {}}
          onPromoteToTask={() => {}}
          onRevealAnchor={() => {}}
          onClose={() => {}}
          locked={{ onUnlock }}
        />,
      );
    });
    expect(host.textContent).toContain(tr("comments.commentsLocked"));
    expect(host.textContent).not.toContain(tr("comments.commentsNone"));
    expect(host.querySelector(".pv-comment-compose")).toBeNull();
    await act(async () => { (host.querySelector('[data-testid="comments-unlock"]') as HTMLButtonElement).click(); });
    expect(onUnlock).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
    host.remove();
  });
});
