import { useEffect, useRef, useState } from "react";
import { DEFAULT_CLIENT_ID, pollDeviceFlow, startDeviceFlow, type DeviceCode } from "../lib/auth";
import { openUrl } from "../lib/platform";
import { useApp } from "../lib/state";
import { Spinner } from "./bits";
import { Icon } from "./Icon";

// One button → a small prompt with the one-time code → GitHub opens in the
// browser → RepoHub signs in by itself as soon as you approve.

export function Login() {
  const { settings, setToken, setDemo } = useApp();
  const clientId = DEFAULT_CLIENT_ID || settings.clientId;
  const [code, setCode] = useState<DeviceCode | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  async function signIn() {
    setErr(null);
    setBusy(true);
    try {
      const c = await startDeviceFlow(clientId);
      setCode(c);
      setCopied(await navigator.clipboard?.writeText(c.user_code).then(() => true, () => false) ?? false);
      void openUrl(c.verification_uri);
      abort.current = new AbortController();
      await setToken(await pollDeviceFlow(clientId, c, abort.current.signal));
    } catch (e) {
      if ((e as Error).name !== "AbortError") setErr((e as Error).message);
    } finally {
      setCode(null);
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-card card">
        <img src="/icon.svg" alt="" width={56} height={56} />
        <h1>RepoHub</h1>
        <p className="muted">Live progress for every GitHub project you work on.</p>
        <button className="btn primary big" onClick={signIn} disabled={busy || !clientId}>
          <Icon name="github" /> Sign in with GitHub
        </button>
        {!clientId && <p className="small muted">GitHub sign-in isn't set up in this build yet.</p>}
        {err && <p className="error">{err}</p>}
        <button className="link small" onClick={() => setDemo(true)}>Explore with demo data</button>
      </div>

      {code && (
        <div className="modal-back">
          <div className="modal signin-prompt" role="dialog" aria-label="Finish signing in on GitHub">
            <Icon name="github" size={28} />
            <h2>Finish signing in on GitHub</h2>
            <p className="muted small">GitHub opened in your browser. Paste this code there and approve RepoHub.</p>
            <div className="user-code">{code.user_code}</div>
            <div className="small row gap center">
              {copied ? <><span className="ci ok"><span className="ci-dot"><Icon name="check" size={10} /></span></span> Copied to clipboard</> : "Type this code on the GitHub page"}
            </div>
            <div className="row gap center small muted"><Spinner /> Waiting for approval… this window closes by itself.</div>
            <div className="row gap center">
              <button className="btn" onClick={() => openUrl(code.verification_uri)}><Icon name="external" /> Open GitHub again</button>
              <button className="btn ghost" onClick={() => abort.current?.abort()}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
