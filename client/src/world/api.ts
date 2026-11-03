// CONTRACT of the world (office canvas) consumed by UI (client/src/ui/**).
// Implementation: client/src/world/index.ts -> createWorld().
// Rule: changes here must be ADDITIVE.

import type { LoadThresholds } from '../../../shared/overload';

export type Selection = { type: 'agent'; id: string } | { type: 'room'; id: string } | null;

export interface WorldOptions {
  /** Show labels with character names. */
  showNames: boolean;
  /** Activity speech bubbles: all, important only (needs you, selected, recent changes), or none. */
  bubbles: 'all' | 'important' | 'none';
  /** Frequency of strolls around the office when agents are idle. */
  liveliness: 'calm' | 'normal' | 'lively';
  /** Camera follows selected agent. */
  followSelected: boolean;
  /** Day/night cycle based on local time (windows, lighting). */
  dayNight: boolean;
  /** (Optional, additive) Day/night cycle: auto, always day, or always night. Takes precedence over `dayNight`. */
  daylight?: DaylightMode;
  /** Visual theme: auto (follows calendar; see seasonalThemeFor), none, Christmas, or Halloween. */
  theme?: OfficeTheme;
  /** (Optional, additive) When a session shows as tired or overloaded; absent = the defaults. */
  overload?: LoadThresholds;
}

/** Theme rendered by renderer: original office ('none') or a seasonal one. */
export type SeasonalTheme = 'none' | 'christmas' | 'halloween';
export type OfficeTheme = 'auto' | SeasonalTheme;

/**
 * Theme rendered on a given date (local time). In auto mode: Halloween from October 1 to 31, Christmas from
 * November 1 to December 26, and original office the rest of the year.
 */
export function seasonalThemeFor(theme: OfficeTheme | undefined, date: Date): SeasonalTheme {
  if (theme && theme !== 'auto') return theme;
  const month = date.getMonth();
  if (month === 9) return 'halloween';
  if (month === 10 || (month === 11 && date.getDate() <= 26)) return 'christmas';
  return 'none';
}

/** Day/night cycle: follows local time, or fixed to day or night. */
export type DaylightMode = 'auto' | 'day' | 'night';

/** Ambient sounds suggested by the world (UI decides whether and how to play them). */
export type SoundCueKind = 'keys' | 'elevator';

export interface SoundCue {
  kind: SoundCueKind;
  /** 0..1: proximity (zoom, off-screen...). */
  gain: number;
  /** -1 (left) .. 1 (right): screen position. */
  pan: number;
  /** Keyboard: keystroke count in burst. */
  count?: number;
}

export interface WorldApi {
  /** Selects (or clears) an agent/room. `focus` moves camera to target. */
  select(sel: Selection, opts?: { focus?: boolean }): void;
  getSelection(): Selection;
  /** Fired when selection changes (via canvas click or select()). */
  onSelect(cb: (sel: Selection) => void): () => void;
  /** Agent hovered under cursor (for UI tooltips). */
  onHover(cb: (agentId: string | null) => void): () => void;
  focusAgent(id: string, opts?: { follow?: boolean }): void;
  focusRoom(id: string): void;
  /** Frames the entire building. */
  overview(): void;
  zoomBy(factor: number): void;
  getOptions(): WorldOptions;
  setOptions(o: Partial<WorldOptions>): void;
  /** Screen position (CSS px, relative to viewport) just above character head, or null if not visible. */
  screenPositionOf(agentId: string): { x: number; y: number } | null;
  /**
   * (Optional, additive) Screen area covered by UI panels, in CSS px. World frames
   * (overview) and centers (focusAgent/focusRoom/follow) within free area.
   */
  setViewInsets?(insets: Partial<ViewInsets>): void;
  /** (Optional, additive) Right click on an office room: room id and click position (window px). */
  onRoomContextMenu?(cb: (roomId: string, at: { x: number; y: number }) => void): () => void;
  /**
   * (Optional, additive) Office shown on the page: the world dims (gently) the rooms and characters outside
   * `source()`, called every frame (return the same object while nothing changed); null source or result = no dimming.
   */
  setOfficeFocus?(source: (() => WorldFocus | null) | null): void;
  /**
   * (Optional, additive) One building per office, side by side: the camera flies to this office's building (zoomed
   * to fit it). Unknown id or a single building: nothing happens.
   */
  focusOffice?(officeId: string): void;
  /** (Optional, additive) Ambient sounds: typing by visible workers, elevator, wheels. */
  onSound?(cb: (cue: SoundCue) => void): () => void;
  /**
   * (Optional, additive) Office off-screen (city scene is open): halts rendering and camera keyboard;
   * on return, simulation fast-forwards elapsed time (like background tab).
   */
  setSuspended?(suspended: boolean): void;
  destroy(): void;
}

/** Rooms (RoomInfo.id) and characters (AgentInfo.id) of the office shown; the rest is dimmed. */
export interface WorldFocus {
  roomIds: ReadonlySet<string>;
  agentIds: ReadonlySet<string>;
  /**
   * The office shown (OfficeInfo.id): with several buildings, every other building is dimmed whole (rooms, core,
   * corridor, characters) and roomIds/agentIds are not used. Absent = dim by roomIds/agentIds.
   */
  office?: string;
}

/** Viewport margins covered by UI (CSS px). */
export interface ViewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_WORLD_OPTIONS: WorldOptions = {
  showNames: true,
  bubbles: 'important',
  liveliness: 'normal',
  followSelected: false,
  dayNight: true,
  theme: 'auto',
};
