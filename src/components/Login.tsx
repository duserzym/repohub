import { useEffect, useRef, useState } from "react";
import { pollDeviceFlow, startDeviceFlow, type DeviceCode } from "../lib/auth";
import { httpFetch, openUrl } from "../lib/platform";
import { useApp } from "../lib/state";
import { Spinner } from "./bits";
import { Icon } from "./Icon";

export function Login() {
  const { settings, update, setToken, setDemo } = useApp();
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pat, setPat] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(!settings.clientId);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function deviceLogin() {
    setErr(null);
    setBusy(true);
    try {
      const c = await startDeviceFlow(settings.clientId);
      setCode(c);
      await navigator.clipboard?.writeText(c.user_code).catch(() => {});
      void openUrl(c.verification_uri);
      abort.current = new AbortController();
      const token = await pollDeviceFlow(settings.clientId, c, abort.current.signal);
      await setToken(token);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr((e as Error).message);
      setCode(null);
    } finally {
      setBusy(false);
    }
  }

  async function tokenLogin() {
    setErr(null);
    const t = pat.trim();
    if (!t) return;
    setBusy(true);
    try {
      const res = await httpFetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${t}` } });
      if (!res.ok) throw new Error(res.status === 401 ? "That token was rejected by GitHub." : `GitHub ${res.status}`);
      await setToken(t);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-card card">
        <img src="/icon.svg" alt="" width={56} height={56} />
        <h1>RepoHub</h1>
        <p className="muted">Live progress for every GitHub project you work on.</p>

        {code ? (
          <div className="device">
            <p>Enter this code on GitHub (copied to your clipboard):</p>
            <div className="user-code">{code.user_code}</div>
            <button className="btn" onClick={() => openUrl(code.verification_uri)}>
              <Icon name="external" /> Open github.com/login/device
            </button>
            <p className="small muted row gap center">
              <Spinner /> Waiting for approval…
            </p>
            <button className="btn ghost small" onClick={() => abort.current?.abort()}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <button className="btn primary big" onClick={deviceLogin} disabled={busy || !settings.clientId}>
              <Icon name="github" /> Sign in with GitHub
            </button>
            {!settings.clientId && <p className="small muted">Add your OAuth App client ID below to enable browser sign-in.</p>}
          </>
        )}

        {err && <p className="error">{err}</p>}

        <button className="link small" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? "Hide" : "Other ways to sign in"}
        </button>
        {showAdvanced && (
          <div className="advanced">
            <label className="field">
              <span>OAuth App client ID (device flow enabled)</span>
              <input
                className="input"
                value={settings.clientId}
                placeholder="Ov23li…"
                onChange={(e) => update("settings", (s) => ({ ...s, clientId: e.target.value.trim() }))}
              />
            </label>
            <label className="field">
              <span>
                Or paste a personal access token (<code>repo</code>, <code>read:org</code>)
              </span>
              <div className="row gap">
                <input className="input grow" type="password" value={pat} onChange={(e) => setPat(e.target.value)} placeholder="ghp_… or github_pat_…" />
                <button className="btn" onClick={tokenLogin} disabled={busy || !pat.trim()}>
                  Use token
                </button>
              </div>
            </label>
            <button className="link small" onClick={() => openUrl("https://github.com/settings/tokens/new?scopes=repo,read:org&description=RepoHub")}>
              Create a token on GitHub
            </button>
          </div>
        )}

        <div className="divider" />
        <button className="btn ghost" onClick={() => setDemo(true)}>
          <Icon name="eye" /> Explore with demo data
        </button>
      </div>
    </div>
  );
}
