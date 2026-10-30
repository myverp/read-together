"use client";
import { useEffect, useRef } from "react";
import { DEFAULT_SETTINGS, TEXT_SIZES, THEMES, FONTS, LINE_HEIGHTS, TEXT_WIDTHS, type ReadingSettings } from "@/lib/reading-settings";

export default function ReadingSettingsDialog({ settings, busy, fixed, storageAvailable, error, onChange, onClose }: {
  settings: ReadingSettings; busy: boolean; fixed: boolean; storageAvailable: boolean; error: string;
  onChange: (settings: ReadingSettings) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current; element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="panel reader-dialog settings-dialog" aria-labelledby="reading-settings-title" onCancel={onClose}>
    <h2 id="reading-settings-title">Reading settings</h2>
    <div className="settings-preview" aria-label="Typography preview" style={{ fontFamily: settings.font === "sans" ? "system-ui, sans-serif" : settings.font === "serif" ? "Georgia, serif" : undefined, fontSize: settings.fontSize, lineHeight: settings.lineHeight }}>A quiet moment with your book.</div>
    <fieldset disabled={busy || fixed} className="typography-settings"><legend>Typography</legend>
    <label htmlFor="reader-font">Font</label><select id="reader-font" value={settings.font} onChange={event => onChange({ ...settings, font: event.target.value as ReadingSettings["font"] })}>{FONTS.map(font => <option key={font} value={font}>{({serif: "Serif - Georgia", sans: "System sans", original: "Book original"})[font]}</option>)}</select>
    <label htmlFor="reader-text-size">Text size</label>
    <div className="text-size-controls"><button className="secondary" aria-label="Decrease text size" disabled={settings.fontSize === 16} onClick={() => onChange({ ...settings, fontSize: settings.fontSize - 2 as ReadingSettings["fontSize"] })}>A-</button>
    <select id="reader-text-size" value={settings.fontSize} onChange={event => onChange({ ...settings, fontSize: Number(event.target.value) as ReadingSettings["fontSize"] })}>{TEXT_SIZES.map(size => <option key={size} value={size}>{size} px</option>)}</select>
    <button className="secondary" aria-label="Increase text size" disabled={settings.fontSize === 32} onClick={() => onChange({ ...settings, fontSize: settings.fontSize + 2 as ReadingSettings["fontSize"] })}>A+</button></div>
    <div className="settings-grid"><div><label htmlFor="reader-line-height">Line spacing</label><select id="reader-line-height" value={settings.lineHeight} onChange={event => onChange({ ...settings, lineHeight: Number(event.target.value) as ReadingSettings["lineHeight"] })}>{LINE_HEIGHTS.map(height => <option key={height} value={height}>{height.toFixed(1)}</option>)}</select></div>
    <div><label htmlFor="reader-width">Text width</label><select id="reader-width" value={settings.textWidth} onChange={event => onChange({ ...settings, textWidth: event.target.value as ReadingSettings["textWidth"] })}>{TEXT_WIDTHS.map(width => <option key={width} value={width}>{width[0].toUpperCase() + width.slice(1)}</option>)}</select></div></div>
    <label htmlFor="reader-alignment">Prose alignment</label><select id="reader-alignment" value={settings.alignment} onChange={event => onChange({ ...settings, alignment: event.target.value as ReadingSettings["alignment"] })}><option value="original">Book original</option><option value="left">Left aligned</option></select>
    </fieldset>
    {fixed && <p>This fixed-layout book keeps its original typography and width. You can change the theme.</p>}
    <fieldset disabled={busy}><legend>Theme</legend><div className="reading-theme-options">{THEMES.map(theme => <label key={theme}>
      <input type="radio" name="reader-theme" value={theme} checked={settings.theme === theme} onChange={() => onChange({ ...settings, theme })} />
      {theme[0].toUpperCase() + theme.slice(1)}
    </label>)}</div></fieldset>
    <button className="secondary" disabled={busy} onClick={() => onChange({ ...DEFAULT_SETTINGS })}>Reset</button>
    <p role="status">{busy ? "Applying reading settings…" : !storageAvailable ? "Settings work for this session, but cannot be saved on this device." : "Saved on this device. Applies to your books in this browser."}</p>
    {error && <p className="error" role="alert">{error}</p>}
    <button className="secondary" onClick={onClose}>Close reading settings</button>
  </dialog>;
}
