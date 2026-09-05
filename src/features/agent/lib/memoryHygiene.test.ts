import { describe, expect, it } from "vitest";
import { REDACTED_SECRET, redactSecrets } from "./memoryHygiene";

describe("redactSecrets", () => {
  it("leaves ordinary prose untouched", () => {
    const text = "The API key is stored in 1Password. Password rotation happens quarterly. token: pending";
    expect(redactSecrets(text)).toEqual({ text, redacted: 0 });
  });

  it.each([
    ["OpenAI key", `use sk-proj-${"A1b2C3d4".repeat(6)} for calls`],
    ["Anthropic key", `ANTHROPIC key sk-ant-api03-${"x9".repeat(24)}`],
    ["GitHub PAT", `token ghp_${"a1B2c3D4e5".repeat(4)} here`],
    ["fine-grained GitHub PAT", `github_pat_${"Ab1".repeat(20)}`],
    ["Slack token", "xoxb-1234567890-abcdefghij-KLMNOP"],
    ["AWS access key", "AKIAIOSFODNN7EXAMPLE"],
    ["Google API key", `AIza${"Sy1".repeat(11)}Ab`],
    [
      "JWT",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    ],
    ["Stripe key", `sk_live_${"4eC39HqLyjWDarjtT1zdp7dc".slice(0, 24)}`],
  ])("redacts a %s", (_label, text) => {
    const result = redactSecrets(text);
    expect(result.redacted).toBe(1);
    expect(result.text).toContain(REDACTED_SECRET);
    expect(result.text).not.toMatch(/sk-|ghp_|xoxb|AKIA|AIza|eyJ|sk_live/);
  });

  it("redacts bearer tokens but keeps the scheme", () => {
    const result = redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789");
    expect(result.text).toBe(`Authorization: Bearer ${REDACTED_SECRET}`);
    expect(result.redacted).toBe(1);
  });

  it("redacts key=value style credentials", () => {
    const result = redactSecrets(
      ["password: hunter22", "API_KEY=abc123def456", 'client_secret: "s3cr3tvalue"'].join("\n"),
    );
    expect(result.text).toBe(
      [`password: ${REDACTED_SECRET}`, `API_KEY=${REDACTED_SECRET}`, `client_secret: "${REDACTED_SECRET}"`].join("\n"),
    );
    expect(result.redacted).toBe(3);
  });

  it("does not treat short, word-like values after a secret key as secrets", () => {
    const text = "password: rotate\napi key: vault\ntoken: expired";
    expect(redactSecrets(text).text).toBe(text);
  });

  it("redacts PEM private keys as a single block", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nabc\n-----END RSA PRIVATE KEY-----";
    const result = redactSecrets(`Key:\n${pem}\nend`);
    expect(result.text).toBe(`Key:\n${REDACTED_SECRET}\nend`);
    expect(result.redacted).toBe(1);
  });

  it("is idempotent", () => {
    const once = redactSecrets("password: hunter22 and ghp_" + "a1B2c3D4e5".repeat(4));
    const twice = redactSecrets(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.redacted).toBe(0);
  });
});
