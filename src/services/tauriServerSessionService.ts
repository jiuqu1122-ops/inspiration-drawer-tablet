import { invoke, isTauri } from "@tauri-apps/api/core";

export interface ServerSession {
  authenticated: boolean;
  email?: string;
  displayName?: string;
  availableCredits?: string;
  expiresAt?: string;
}

export interface EmailCodeChallenge {
  challengeId: string;
  expiresIn: number;
  resendAfter: number;
}

export async function getServerSession(): Promise<ServerSession> {
  if (!isTauri()) {
    return { authenticated: false };
  }
  return invoke<ServerSession>("get_server_session");
}

export async function requestServerEmailCode(email: string): Promise<EmailCodeChallenge> {
  assertTauriRuntime();
  return invoke<EmailCodeChallenge>("request_server_email_code", {
    input: { email: email.trim() },
  });
}

export async function verifyServerEmailCode(input: {
  email: string;
  challengeId: string;
  code: string;
  displayName?: string;
}): Promise<ServerSession> {
  assertTauriRuntime();
  return invoke<ServerSession>("verify_server_email_code", {
    input: {
      email: input.email.trim(),
      challengeId: input.challengeId,
      code: input.code.trim(),
      displayName: input.displayName?.trim() || undefined,
    },
  });
}

export async function logoutServerSession(): Promise<void> {
  assertTauriRuntime();
  await invoke("logout_server_session");
}

function assertTauriRuntime(): void {
  if (!isTauri()) {
    throw new Error("账号登录需要在 Android 应用中运行");
  }
}
