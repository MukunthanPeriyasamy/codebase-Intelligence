import { useEffect, useState } from 'react';
import type { DesktopStatus, Result } from '../shared/contracts';
export function OpenRouterAccess({ status, busy, active, act }: { status: DesktopStatus | null; busy: boolean; active: boolean; act: (action: () => Promise<Result>, success?: string) => Promise<void> }) {
  const [key, setKey] = useState('');
  useEffect(() => { if (!active) setKey(''); }, [active]);
  return <section className="panel" aria-labelledby="openrouter-title"><div className="panel-heading"><h2 id="openrouter-title">Connect OpenRouter</h2><span data-testid="credential-state">{status?.credential.configured ? 'Key saved' : 'Not configured'}</span></div>
    <p>The key is encrypted on this device. Select OpenRouter in Generation settings to use it for documentation and chat. Saving a key does not send a model request.</p>
    <form onSubmit={event => { event.preventDefault(); const value = key; setKey(''); void act(() => window.desktop.saveCredential(value), 'OpenRouter key saved securely.'); }}><label>OpenRouter API key<input type="password" value={key} maxLength={512} autoComplete="off" spellCheck={false} onChange={event => setKey(event.target.value)} disabled={busy || !status?.credential.available} /></label><button disabled={busy || !status?.credential.available || key.trim().length < 8}>Save key</button></form>
    {!status?.credential.available && <p className="error">OS key encryption is unavailable. Ollama remains usable.</p>}
    {status?.credential.error && <p role="alert" className="error">{status.credential.error}</p>}
    <button disabled={busy || !status} onClick={() => void act(() => window.desktop.clearCredential(), 'OpenRouter key removed.')}>Remove saved key</button>
  </section>;
}
