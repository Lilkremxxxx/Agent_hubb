// The two HTML pages of the remote port: sign-in and "Passkeys". Server-rendered (text through tr()), one shared
// stylesheet (Ocean Depth, UI_UX/design/DESIGN.md), no inline script: the only code is /assets/remote/auth.js.
import { getLocale, tr } from '../../shared/i18n';

/** Our own text inside HTML: escapes what HTML would interpret. */
export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Texts for the browser script, as data. "<" is escaped, so no text can close the tag. */
export function jsonBlock(texts: Record<string, string>): string {
  return `<script type="application/json" id="auth-t">${JSON.stringify(texts).replace(/</g, '\\u003c')}</script>`;
}

const CSS = `
  :root { color-scheme: dark; --bg: #04101f; --ink: 226 240 250; --ink-2: 140 170 192; --accent: #3ec7d3; --accent-2: #6a8cff; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg);
         background-image: radial-gradient(ellipse at 50% 0%, #0b3a5c 0%, transparent 70%);
         color: rgb(var(--ink)); font: 16px/1.45 Inter, system-ui, sans-serif; }
  main { width: 100%; max-width: 380px; padding: 24px; background: rgb(255 255 255 / 0.08); backdrop-filter: blur(24px) saturate(1.4);
         -webkit-backdrop-filter: blur(24px) saturate(1.4); border: 1px solid rgb(120 220 240 / 0.18); border-radius: 22px;
         box-shadow: inset 0 1px 0 rgb(180 240 255 / 0.25), 0 16px 48px rgb(0 10 30 / 0.6);
         animation: rise 450ms cubic-bezier(0.2, 0, 0, 1) both; }
  @keyframes rise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { main { animation: none; } button { transition: none; } }
  img { display: block; width: 72px; height: 72px; margin: 0 auto 12px; border-radius: 16px; }
  h1 { margin: 0 0 4px; font-size: 22px; text-align: center; }
  p { margin: 0 0 16px; color: rgb(var(--ink-2)); font-size: 14px; }
  a { color: var(--accent); }
  label { display: block; font-size: 13px; color: rgb(var(--ink-2)); margin: 12px 0 6px; }
  input { width: 100%; padding: 12px; font: inherit; color: inherit; background: rgb(4 16 31 / 0.6); border: 1px solid rgb(120 220 240 / 0.18); border-radius: 12px; }
  input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  button { width: 100%; margin-top: 16px; padding: 12px; font: inherit; font-weight: 700; color: #04101f; cursor: pointer;
           background: linear-gradient(135deg, #3ec7d3, #6a8cff); border: 0; border-radius: 12px; transition: transform 150ms; }
  button:active { transform: scale(0.97); }
  button:disabled { opacity: .6; cursor: wait; }
  button.ghost { color: rgb(var(--ink)); background: rgb(255 255 255 / 0.08); border: 1px solid rgb(120 220 240 / 0.18); }
  button.small { width: auto; margin: 0; padding: 6px 12px; font-size: 13px; }
  #err { min-height: 20px; margin-top: 12px; color: #ff6b7a; font-size: 13px; }
  ul { list-style: none; margin: 0 0 16px; padding: 0; }
  li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 0; border-bottom: 1px solid rgb(120 220 240 / 0.12); }
  li span { overflow-wrap: anywhere; }
  small { display: block; color: rgb(var(--ink-2)); font: 12px 'JetBrains Mono', ui-monospace, monospace; }
  .hr { margin: 20px 0 0; font-size: 12px; }
`;

function shell(title: string, page: string, texts: Record<string, string>, body: string): string {
  return `<!doctype html>
<html lang="${getLocale()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/assets/brand/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Habblaud">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<style>${CSS}</style>
</head>
<body data-page="${page}">
<main>
  <img src="/assets/brand/finstar.png" alt="">
${body}
</main>
${jsonBlock(texts)}
<script type="module" src="/assets/remote/auth.js"></script>
</body>
</html>
`;
}

const common = () => ({ failed: tr("Couldn't sign in."), cancelled: tr('Passkey cancelled.'), offline: tr('No connection to Habblaud.') });

export function loginPage(o: { caDownload: boolean; passkeys: boolean; password: boolean; caPath?: string }): string {
  const ca = o.caDownload
    ? `<p class="hr">${esc(tr('First time on this phone?'))} <a href="${o.caPath ?? '/remote/ca.crt'}" download="habblaud-ca.crt">${esc(tr('Install the Habblaud certificate'))}</a> ${esc(tr('to remove the security warning (check the fingerprint that npm run remote:setup showed).'))}</p>`
    : '';
  const body = `  <h1>${esc(tr('Bang_ver hub'))}</h1>
  ${o.passkeys ? `<button id="pk" type="button">${esc(tr('Sign in with a passkey'))}</button>` : ''}
  ${o.password ? `<form id="f" autocomplete="on">
    <label for="u">${esc(tr('Username'))}</label>
    <input id="u" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
    <label for="p">${esc(tr('Password'))}</label>
    <input id="p" name="password" type="password" autocomplete="current-password" required>
    <button id="b" type="submit">${esc(tr('Sign in'))}</button>
  </form>` : ''}
  <div id="err" role="alert"></div>
  ${ca}`;
  return shell(tr('Habblaud · sign in'), 'login', common(), body);
}

export function securityPage(): string {
  const body = `  <h1>${esc(tr('Passkeys'))}</h1>
  <p>${esc(tr('Passkeys that sign you in from outside.'))}</p>
  <ul id="list" aria-live="polite"></ul>
  <label for="n">${esc(tr('Name'))}</label>
  <input id="n" maxlength="60" autocomplete="off" placeholder="${esc(tr('Phone'))}">
  <button id="add" type="button">${esc(tr('Add a passkey'))}</button>
  <button id="again" type="button" class="ghost" hidden>${esc(tr('Sign in again'))}</button>
  <div id="err" role="alert"></div>
  <p class="hr">${esc(tr('Lost your only passkey? At the computer: npm run remote:setup -- --reset-passkeys, then restart the office.'))}</p>
  <p><a href="/">${esc(tr('Back to the office'))}</a></p>`;
  return shell(tr('Habblaud · passkeys'), 'security', { ...common(), none: tr('No passkeys yet.'), remove: tr('Remove'), added: tr('Passkey added.'), removed: tr('Passkey removed.'), loadFail: tr("Couldn't load the passkeys.") }, body);
}
