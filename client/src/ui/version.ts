// Habblaud version: the number in the topbar and the "About" settings section.
import type { OfficeSnapshot } from '../../../shared/types';
import type { UiComponent, UiContext } from './context';
import { h, setAttr, setHidden, setText, setTitle } from './dom';
import { pixelIcon } from './icons';
import { tr } from '../../../shared/i18n';

export const VERSION_ICONS = {
  up: pixelIcon(['...##...', '..####..', '.######.', '########', '..####..', '..####..', '..####..', '..####..']),
};

/** In-use version, from live snapshot (no real version in timelapse). */
export function versionInfo(snap: OfficeSnapshot | null | undefined): { version: string } | null {
  const v = snap?.meta.version;
  if (!v || !/^\d+\.\d+\.\d+/.test(v)) return null;
  return { version: v };
}

/** Version number in the topbar. */
export class VersionChip implements UiComponent {
  readonly el: HTMLButtonElement;
  private text: HTMLElement;

  constructor(
    private ctx: UiContext,
    private settingsBtn: HTMLElement,
  ) {
    const icon = h('span', { class: 'ui-version__icon', attrs: { 'aria-hidden': 'true' } });
    icon.innerHTML = VERSION_ICONS.up;
    this.text = h('span', { class: 'ui-version__text' });
    this.el = h('button', { class: 'ui-version', type: 'button', hidden: true, on: { click: () => ctx.openAbout() } }, icon, this.text);
  }

  render(): void {
    const info = versionInfo(this.ctx.store.liveSnapshot);
    setHidden(this.el, !info);
    const label = tr('Settings');
    setAttr(this.settingsBtn, 'aria-label', label);
    setTitle(this.settingsBtn, label);
    if (!info) return;
    setText(this.text, `v${info.version}`);
    const title = tr('Habblaud v{0}. Click for details.', [info.version]);
    setTitle(this.el, title);
    setAttr(this.el, 'aria-label', title);
  }
}

/** "About" settings section. */
export class AboutGroup {
  readonly el: HTMLElement;
  private name: HTMLElement;

  constructor(private ctx: UiContext) {
    this.name = h('strong', { class: 'ui-about__version' });
    this.el = h(
      'div',
      { class: 'ui-set-group ui-about', attrs: { id: 'ui-about' } },
      h('h3', { text: tr('About'), tabIndex: -1 }),
      h('div', { class: 'ui-about__head' }, h('span', { class: 'ui-about__name' }, 'Habblaud ', this.name)),
    );
  }

  render(): void {
    const info = versionInfo(this.ctx.store.liveSnapshot);
    setHidden(this.el, !info);
    if (!info) return;
    setText(this.name, `v${info.version}`);
  }

  /** Scrolls to the section and highlights it briefly (clicking the version number). */
  highlight(): void {
    this.el.scrollIntoView({ block: 'nearest' });
    this.el.classList.remove('is-highlight');
    void this.el.offsetWidth;
    this.el.classList.add('is-highlight');
  }
}
