import { httpFetch } from "./platform";
import { deleteSecret, getSecret, setSecret } from "./storage";

// GitHub OAuth *device flow* — the recommended login for desktop and mobile
// apps. It needs only a public client ID (no client secret is shipped).
// https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

export const TOKEN_KEY = "github-token";
export const SCOPES = "repo read:org read:user";
// Public OAuth App client ID for RepoHub (client IDs are not secret).
// Override with VITE_GITHUB_CLIENT_ID for a fork or a different OAuth App.
export const DEFAULT_CLIENT_ID = (import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined) || "Ov23liAaqYPNVsBbVVJb";

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export async function startDeviceFlow(clientId: string): Promise<DeviceCode> {
  if (!clientId) throw new Error("GitHub sign-in isn't set up in this build yet.");
  const res = await httpFetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope: SCOPES }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error_description || data.error || `HTTP ${res.status}`);
  return data as DeviceCode;
}

/** Polls until the user approves the code in the browser. */
export async function pollDeviceFlow(clientId: string, code: DeviceCode, signal: AbortSignal): Promise<string> {
  let interval = Math.max(code.interval, 5) * 1000;
  const deadline = Date.now() + code.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(interval, signal);
    const res = await httpFetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        device_code: code.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      signal,
    });
    const data = await res.json();
    if (data.access_token) return data.access_token as string;
    switch (data.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        interval = (data.interval ?? interval / 1000 + 5) * 1000;
        continue;
      case "expired_token":
        throw new Error("The code expired. Start again.");
      case "access_denied":
        throw new Error("Authorization was cancelled.");
      default:
        throw new Error(data.error_description || data.error || "Login failed");
    }
  }
  throw new Error("The code expired. Start again.");
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

export const loadToken = () => getSecret(TOKEN_KEY);
export const saveToken = (t: string) => setSecret(TOKEN_KEY, t);
export const clearToken = () => deleteSecret(TOKEN_KEY);
