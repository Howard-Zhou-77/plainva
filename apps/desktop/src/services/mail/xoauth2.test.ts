import { afterEach, describe, expect, it, vi } from "vitest";
import { ImapConnection, setMailSocket, type MailSocket } from "@plainva/ui/mail";
import { smtpSend } from "../../../../../packages/ui/src/mail/net/smtp";
import { MAIL_OAUTH_REJECTED, xoauth2Payload } from "../../../../../packages/ui/src/mail/net/xoauth2";
import { sessionKey } from "../../../../../packages/ui/src/mail/net/sessionPool";

class Server implements MailSocket {
  written: string[] = [];
  closed = false;
  private queue: string[];
  constructor(greeting: string, private readonly reply: (line: string) => string) { this.queue = [greeting]; }
  async open() { return "socket"; }
  async startTls() {}
  async write(_id: string, data: string) {
    const text = Buffer.from(data, "base64").toString("utf8");
    this.written.push(text);
    this.queue.push(this.reply(text));
  }
  async read() { return Buffer.from(this.queue.shift() ?? "", "utf8").toString("base64"); }
  async close() { this.closed = true; }
}
const creds = { host: "imap.gmail.com", port: 993, user: "test@example.test", pass: "fake-token", auth: "xoauth2" as const };
afterEach(() => setMailSocket(null));

describe("mail XOAUTH2 protocol", () => {
  it.each([true, false])("handles IMAP continuation and redacts a rejected token (accepted=%s)", async accepted => {
    const server = new Server("* OK ready\r\n", line => {
      if (line === "a1 CAPABILITY\r\n") return "* CAPABILITY IMAP4rev1 AUTH=XOAUTH2\r\na1 OK capability\r\n";
      if (line === "a2 AUTHENTICATE XOAUTH2\r\n") return "+ \r\n";
      if (line === xoauth2Payload(creds.user, creds.pass) + "\r\n") return accepted ? "a2 OK authenticated\r\n" : "+ eyJzdGF0dXMiOiI0MDEifQ==\r\n";
      if (line === "\r\n") return "a2 NO fake-token should never reach the error\r\n";
      return "a3 OK logout\r\n";
    });
    setMailSocket(server);
    if (accepted) { const conn = await ImapConnection.connect(creds); await conn.close(); }
    else await expect(ImapConnection.connect(creds)).rejects.toThrow(new RegExp(`^${MAIL_OAUTH_REJECTED}$`));
    expect(server.written.some(line => line.includes("LOGIN"))).toBe(false);
    expect(server.closed).toBe(true);
    if (!accepted) expect(server.written).toContain("\r\n");
  });

  it.each([true, false])("uses SMTP XOAUTH2 without password fallback (accepted=%s)", async accepted => {
    let data = false;
    const server = new Server("220 ready\r\n", line => {
      if (line === "EHLO plainva\r\n") return "250-server\r\n250 AUTH PLAIN LOGIN XOAUTH2\r\n";
      if (line.startsWith("AUTH XOAUTH2 ")) return accepted ? "235 authenticated\r\n" : "334 eyJzdGF0dXMiOiI0MDEifQ==\r\n";
      if (line === "\r\n") return "535 fake-token should never reach the error\r\n";
      if (line === "DATA\r\n") { data = true; return "354 send\r\n"; }
      if (line === "QUIT\r\n") return "221 bye\r\n";
      return "250 accepted\r\n";
    });
    setMailSocket(server);
    const send = smtpSend({ ...creds, host: "smtp.gmail.com", port: 465, from: creds.user, to: "recipient@example.test", subject: "test", text: "test" }, "Subject: test\r\n\r\ntest");
    if (accepted) await send; else await expect(send).rejects.toThrow(new RegExp(`^${MAIL_OAUTH_REJECTED}$`));
    expect(data).toBe(accepted);
    expect(server.written.some(line => /^AUTH (PLAIN|LOGIN)/.test(line))).toBe(false);
    expect(server.closed).toBe(true);
  });

  it("rejects SASL separator injection and separates token and password sessions", () => {
    expect(() => xoauth2Payload("bad\x01user", "token")).toThrow();
    expect(() => xoauth2Payload("user", "token\r\ncommand")).toThrow();
    expect(sessionKey(creds)).not.toBe(sessionKey({ ...creds, auth: "password" }));
    expect(sessionKey(creds)).not.toContain(creds.pass);
  });
});

const token = vi.hoisted(() => vi.fn());
vi.mock("../../../../../packages/ui/src/mail/graphMail", () => ({ mailAccessTokenFor: token }));
import { withMailCredentials } from "../../../../../packages/ui/src/mail/mailCredentials";
import { vacationSupport } from "../../../../../packages/ui/src/mail/vacation";
const gmail = { id: "gmail", label: "test", kind: "gmail" as const, host: "imap.gmail.com", port: 993, user: creds.user, smtpHost: "smtp.gmail.com", smtpPort: 465 };
describe("mail OAuth renewal", () => {
  it("never offers a password-only Sieve endpoint for an imported Gmail configuration", () => {
    expect(vacationSupport({ ...gmail, sieveHost: "other.example.test", sievePort: 4190 })).toEqual({ kind: "none" });
  });
  it("renews a rejected cached access token once before retrying authentication", async () => {
    token.mockReset().mockResolvedValueOnce("old").mockResolvedValueOnce("new");
    const operation = vi.fn().mockRejectedValueOnce(new Error(MAIL_OAUTH_REJECTED)).mockResolvedValue("ok");
    expect(await withMailCredentials("v", gmail, operation)).toBe("ok");
    expect(operation.mock.calls.map(call => call[0].pass)).toEqual(["old", "new"]);
    expect(token.mock.calls.map(call => call[2])).toEqual([false, true]);
  });
  it("does not retry a disconnect after a possibly completed submission", async () => {
    token.mockReset().mockResolvedValue("token");
    const operation = vi.fn().mockRejectedValue(new Error("connection closed after DATA"));
    await expect(withMailCredentials("v", gmail, operation)).rejects.toThrow("after DATA");
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("never forwards a Google token to an edited server", async () => {
    token.mockClear();
    await expect(withMailCredentials("v", { ...gmail, smtpHost: "other.example.test" }, vi.fn())).rejects.toThrow("Invalid Gmail server");
    expect(token).not.toHaveBeenCalled();
  });
});
