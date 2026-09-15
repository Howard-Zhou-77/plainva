import { beforeEach, describe, expect, it, vi } from "vitest";
import { setPlatformServices } from "@plainva/ui";
import { applyMailBulk, setMailPlatform, type MailTransport, type MailAccountConfig, type ImapBulkArgs } from "@plainva/ui/mail";
import { bodyStructureAttachments } from "../../../../../packages/ui/src/mail/net/bodyStructure";

const account: MailAccountConfig = { id: "mail", label: "Mail", user: "person@example.test", host: "imap.example.test", port: 993 };
const action = vi.fn(async (_creds: unknown, args: ImapBulkArgs) => args.uids.map(uid => ({ uid, status: "done" as const })));
beforeEach(() => {
  action.mockReset().mockImplementation(async (_creds, args) => args.uids.map(uid => ({ uid, status: "done" })));
  setMailPlatform({ transport: { bulkAction: action } as unknown as MailTransport, http: { api: fetch, token: fetch } });
  setPlatformServices({ loadSettings: async () => ({ get: async () => undefined, set: async () => {}, delete: async () => true, keys: async () => [], save: async () => {} }), credentials: { readSecret: async <T,>() => ({ pass: "test-password" }) as T, writeSecret: async () => {}, removeSecret: async () => {} }, openExternal: async () => {} });
});
describe("mail UID batch orchestration", () => {
  const messages = Array.from({ length: 205 }, (_, i) => ({ id: String(i + 1), uidValidity: 9 }));
  it("bounds commands and returns a result for every original UID", async () => {
    const result = await applyMailBulk("vault", account, "INBOX", messages, { kind: "seen", value: true });
    expect(action.mock.calls.map(call => call[1].uids.length)).toEqual([100, 100, 5]);
    expect(result.filter(r => r.status === "done")).toHaveLength(205);
    expect(action.mock.calls.every(call => call[1].uidValidity === 9 && call[1].mailbox === "INBOX")).toBe(true);
  });
  it("does not send an old cache row without a mailbox epoch", async () => {
    expect(await applyMailBulk("vault", account, "INBOX", [{ id: "1" }], { kind: "delete" })).toEqual([{ id: "1", status: "failed", reason: "changed" }]);
    expect(action).not.toHaveBeenCalled();
  });
  it("stops after the current acknowledged batch when cancelled", async () => {
    const controller = new AbortController();
    action.mockImplementationOnce(async (_creds, args) => { controller.abort(); return args.uids.map(uid => ({ uid, status: "done" })); });
    const result = await applyMailBulk("vault", account, "INBOX", messages, { kind: "move", target: "Archive" }, controller.signal);
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.filter(r => r.status === "done")).toHaveLength(100);
    expect(result.filter(r => r.reason === "cancelled")).toHaveLength(105);
  });
  it("never retries a command whose server acknowledgement was lost", async () => {
    action.mockRejectedValueOnce(new Error("socket closed after write"));
    const result = await applyMailBulk("vault", account, "INBOX", messages, { kind: "move", target: "Archive" });
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.filter(r => r.status === "uncertain")).toHaveLength(100);
    expect(result.filter(r => r.status === "skipped")).toHaveLength(105);
  });
});

describe("bounded attachment metadata", () => {
  it("distinguishes text, files and unknown structures", () => {
    expect(bodyStructureAttachments('* 1 FETCH (BODYSTRUCTURE ("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 50 2))')).toBe(false);
    expect(bodyStructureAttachments('* 1 FETCH (BODYSTRUCTURE (("TEXT" "PLAIN" NIL NIL NIL "7BIT" 5 1)("APPLICATION" "PDF" ("NAME" "invoice.pdf") NIL NIL "BASE64" 90 NIL ("ATTACHMENT" ("FILENAME" "invoice.pdf"))) "MIXED"))')).toBe(true);
    expect(bodyStructureAttachments('* 1 FETCH (FLAGS (\\Seen))')).toBeUndefined();
    expect(bodyStructureAttachments('BODYSTRUCTURE ("TEXT"')).toBeUndefined();
    expect(bodyStructureAttachments('BODYSTRUCTURE (' + '('.repeat(30))).toBeUndefined();
  });
});
