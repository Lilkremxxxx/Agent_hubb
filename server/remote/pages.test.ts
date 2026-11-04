import { describe, expect, it } from 'vitest';
import { jsonBlock, loginPage, securityPage } from './pages';

describe('remote pages', () => {
  it('login page: Ocean Depth tokens, reduced motion, phone width, two scripts, passkey button and password form by flag', () => {
    const both = loginPage({ caDownload: false, passkeys: true, password: true });
    for (const s of ['#04101f', '#3ec7d3', '#6a8cff', 'blur(24px)', 'border-radius: 22px', 'prefers-reduced-motion: reduce', 'max-width: 380px', '/assets/brand/finstar-144.png', 'data-page="login"']) expect(both).toContain(s);
    expect(both.match(/<script/g)).toHaveLength(2);
    expect(both).toContain('src="/assets/remote/auth.js"');
    expect(both).toContain('Sign in with a passkey');
    expect(loginPage({ caDownload: false, passkeys: true, password: false })).not.toContain('type="password"');
    expect(loginPage({ caDownload: false, passkeys: false, password: true })).not.toContain('Sign in with a passkey');
  });

  it('the text block cannot close its script tag', () => {
    const b = jsonBlock({ a: '</script><b>' });
    expect(b.indexOf('</script>')).toBe(b.length - '</script>'.length);
  });

  it('security page: list, add, reset hint, back link, same scripts', () => {
    const p = securityPage();
    for (const s of ['data-page="security"', 'Add a passkey', '--reset-passkeys', 'href="/"', 'Sign in again']) expect(p).toContain(s);
    expect(p.match(/<script/g)).toHaveLength(2);
  });

  it('the form cannot put the password in the URL even without JavaScript, and says JavaScript is needed', () => {
    const p = loginPage({ caDownload: false, passkeys: false, password: true });
    expect(p).toMatch(/<form[^>]*method="post"/);
    expect(p).toContain('<noscript>');
  });
});
