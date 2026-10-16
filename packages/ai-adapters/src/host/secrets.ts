/**
 * The operating system's own store for secrets, used for keys the user
 * enters (such as a YouTube Data API key). Secrets are never written to the
 * library database, settings or logs.
 *
 *   macOS  the login Keychain, through /usr/bin/security. The secret is
 *          passed on standard input, never as an argument, so other
 *          processes cannot read it from the process list.
 *   Linux  the Secret Service (GNOME Keyring, KWallet), through
 *          `secret-tool` from libsecret, when it is installed.
 *   Windows not implemented yet; keys are kept for the session only.
 */
import { runCommand, runCommandWithInput } from "./exec";
import type { HostPlatform } from "./platform";
import { locateExecutable } from "./tools";

export interface SecretStore {
  /** Shown to the user, such as "macOS Keychain". */
  readonly name: string;
  available(): Promise<boolean>;
  get(account: string): Promise<string | null>;
  /** Throws when the secret could not be stored. */
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

/** Every part of a command must be plain, so nothing can be injected. */
const SAFE = /^[A-Za-z0-9._-]{1,200}$/;

function checkSafe(...values: string[]): void {
  for (const value of values) {
    if (!SAFE.test(value)) {
      throw new Error("Only letters, digits, '.', '_' and '-' can be stored.");
    }
  }
}

export class MacosKeychain implements SecretStore {
  readonly name = "macOS Keychain";

  constructor(
    private readonly service: string,
    private readonly security = "/usr/bin/security",
  ) {
    checkSafe(service);
  }

  async available(): Promise<boolean> {
    const result = await runCommand(this.security, ["help"], {
      timeoutMs: 5000,
    });
    return result.ok || result.stdout.length > 0 || result.stderr.length > 0;
  }

  async get(account: string): Promise<string | null> {
    checkSafe(account);
    const result = await runCommand(
      this.security,
      ["find-generic-password", "-s", this.service, "-a", account, "-w"],
      { timeoutMs: 10_000 },
    );
    const value = result.stdout.trim();
    return result.ok && value !== "" ? value : null;
  }

  async set(account: string, secret: string): Promise<void> {
    checkSafe(account, secret);
    // Interactive mode reads the command from standard input.
    await runCommandWithInput(
      this.security,
      ["-i"],
      `add-generic-password -U -s ${this.service} -a ${account} -w ${secret}\n`,
      { timeoutMs: 15_000 },
    );
    // Interactive mode does not report failures in its exit code, so the
    // secret is read back to confirm it was stored.
    if ((await this.get(account)) !== secret) {
      throw new Error("The Keychain did not accept the key. It may be locked.");
    }
  }

  async delete(account: string): Promise<void> {
    checkSafe(account);
    await runCommand(
      this.security,
      ["delete-generic-password", "-s", this.service, "-a", account],
      { timeoutMs: 10_000 },
    );
  }
}

export class SecretServiceStore implements SecretStore {
  readonly name = "Secret Service (libsecret)";

  constructor(
    private readonly service: string,
    private readonly secretTool: string | null,
  ) {
    checkSafe(service);
  }

  async available(): Promise<boolean> {
    return this.secretTool !== null;
  }

  async get(account: string): Promise<string | null> {
    checkSafe(account);
    if (!this.secretTool) return null;
    const result = await runCommand(
      this.secretTool,
      ["lookup", "service", this.service, "account", account],
      { timeoutMs: 10_000 },
    );
    const value = result.stdout.trim();
    return result.ok && value !== "" ? value : null;
  }

  async set(account: string, secret: string): Promise<void> {
    checkSafe(account, secret);
    if (!this.secretTool) throw new Error("secret-tool is not installed.");
    const result = await runCommandWithInput(
      this.secretTool,
      [
        "store",
        `--label=${this.service} ${account}`,
        "service",
        this.service,
        "account",
        account,
      ],
      secret,
      { timeoutMs: 15_000 },
    );
    if (!result.ok) {
      throw new Error("The Secret Service did not accept the key.");
    }
  }

  async delete(account: string): Promise<void> {
    checkSafe(account);
    if (!this.secretTool) return;
    await runCommand(
      this.secretTool,
      ["clear", "service", this.service, "account", account],
      { timeoutMs: 10_000 },
    );
  }
}

/**
 * The secret store for this computer, or null where Framebop has none
 * (Windows for now, and Linux without `secret-tool`).
 */
export async function createSecretStore(
  host: HostPlatform,
  service: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SecretStore | null> {
  if (host.os === "macos") return new MacosKeychain(service);
  if (host.os === "linux") {
    const secretTool = await locateExecutable(host, "secret-tool", env);
    return secretTool ? new SecretServiceStore(service, secretTool) : null;
  }
  return null;
}
