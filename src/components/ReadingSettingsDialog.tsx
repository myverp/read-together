"use client";
import { useEffect, useRef } from "react";
import { DEFAULT_SETTINGS, TEXT_SIZES, THEMES, type ReadingSettings } from "@/lib/reading-settings";

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
    <label htmlFor="reader-text-size">Text size</label>
    <select id="reader-text-size" value={settings.fontSize} disabled={busy || fixed} onChange={event => onChange({ ...settings, fontSize: Number(event.target.value) as ReadingSettings["fontSize"] })}>
      {TEXT_SIZES.map(size => <option key={size} value={size}>{size} px</option>)}
    </select>
    {fixed && <p>This fixed-layout book does not support changing text size.</p>}
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
