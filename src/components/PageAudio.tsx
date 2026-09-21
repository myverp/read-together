"use client";
import { useEffect, useRef, useState } from "react";
import { apiHeaders } from "@/lib/client";
import { DeviceSpeechController, type SpeechState } from "@/lib/device-speech";

export type AudioVoice = { id: string; name: string };
export type PageAudioController = { stop: () => void; pause: () => void };
type Mode = "device" | "elevenlabs";
const SETTINGS = "read-together:audio-settings:v1";
const RATES = [0.75, 1, 1.25, 1.5, 2];

function safeSettings(): { mode: Mode; voice: string; rate: number; continueReading: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS) || "{}");
    return { mode: value.mode === "elevenlabs" ? "elevenlabs" : "device", voice: typeof value.voice === "string" ? value.voice : "", rate: RATES.includes(value.rate) ? value.rate : 1, continueReading: !!value.continueReading };
  } catch { return { mode: "device", voice: "", rate: 1, continueReading: false }; }
}

export default function PageAudio({ code, text, apiKey, setApiKey, preferredVoice, setPreferredVoice, onNextPage, onClose, onController }: {
  code: string; text: string; apiKey: string; setApiKey: (key: string) => void; onClose: () => void;
  preferredVoice: AudioVoice | null; setPreferredVoice: (voice: AudioVoice | null) => void;
  onNextPage: () => Promise<string | null>; onController: (controller: PageAudioController | null) => void;
}) {
  const initial = useRef(typeof window === "undefined" ? { mode: "device" as Mode, voice: "", rate: 1, continueReading: false } : safeSettings());
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const pending = useRef<AbortController | null>(null);
  const objectUrl = useRef("");
  const device = useRef<DeviceSpeechController | null>(null);
  const textRef = useRef(text); textRef.current = text;
  const [mode, setMode] = useState<Mode>(initial.current.mode);
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [systemVoice, setSystemVoice] = useState(initial.current.voice);
  const [rate, setRate] = useState(initial.current.rate);
  const [continueReading, setContinueReading] = useState(initial.current.continueReading);
  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [voices, setVoices] = useState<AudioVoice[]>(preferredVoice ? [preferredVoice] : []);
  const [voice, setVoice] = useState(preferredVoice?.id || "");
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<"voices" | "speech" | null>(null);
  const [error, setError] = useState("");
  const [source, setSource] = useState("");

  useEffect(() => {
    dialog.current?.showModal(); heading.current?.focus();
    const synthesis = "speechSynthesis" in window ? window.speechSynthesis : null;
    const controller = new DeviceSpeechController(synthesis, content => new SpeechSynthesisUtterance(content), (state, message) => { setSpeechState(state); if (message) setError(message); });
    device.current = controller; onController(controller);
    const refreshVoices = () => { if (synthesis) setSystemVoices(synthesis.getVoices()); };
    refreshVoices(); synthesis?.addEventListener?.("voiceschanged", refreshVoices);
    if (!synthesis) setSpeechState("unsupported");
    return () => {
      synthesis?.removeEventListener?.("voiceschanged", refreshVoices);
      controller.stop(); device.current = null; onController(null);
      pending.current?.abort(); audio.current?.pause();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, [onController]);

  useEffect(() => { try { localStorage.setItem(SETTINGS, JSON.stringify({ mode, voice: systemVoice, rate, continueReading })); } catch { /* Preferences are optional. */ } }, [mode, systemVoice, rate, continueReading]);
  function resetAudio() { audio.current?.pause(); setSource(""); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = ""; }
  function stopAll() { device.current?.stop(); pending.current?.abort(); pending.current = null; setBusy(null); resetAudio(); }
  function selectedSystemVoice() { return systemVoices.find(item => item.name === systemVoice) || null; }
  function playDevice() {
    setError("");
    if (speechState === "paused") { device.current?.resume(); return; }
    if (speechState === "speaking") { device.current?.pause(); return; }
    device.current?.play({ text: textRef.current, voice: selectedSystemVoice(), rate, continueReading, next: onNextPage });
  }
  async function request(action: "voices" | "speech") {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller; setBusy(action); setError("");
    if (action === "speech") resetAudio();
    try {
      const response = await fetch(`/api/rooms/${code}/speech`, { method: "POST", cache: "no-store", headers: await apiHeaders({ "x-elevenlabs-key": apiKey.trim() }), body: JSON.stringify(action === "voices" ? { action, search } : { action, voice, text: textRef.current }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]) });
      if (!response.ok) { const result = await response.json().catch(() => null); throw new Error(result?.error || "Audio request failed. Please try again."); }
      if (action === "voices") {
        const result = await response.json(); if (controller.signal.aborted) return;
        setVoices(result.voices); setHasMore(result.hasMore); setVoice(result.voices[0]?.id || ""); setPreferredVoice(result.voices[0] || null); resetAudio();
        if (!result.voices.length) setError("No voices found. Try another search or use Device voice.");
      } else {
        const blob = await response.blob(); if (controller.signal.aborted) return;
        if (!blob.size || !blob.type.startsWith("audio/")) throw new Error("The audio response was invalid. Please try again.");
        objectUrl.current = URL.createObjectURL(blob); setSource(objectUrl.current);
      }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error && e.name !== "TimeoutError" ? e.message : "Audio generation timed out. Try Device voice or try again."); }
    finally { if (pending.current === controller) { pending.current = null; setBusy(null); } }
  }
  const deviceUnsupported = speechState === "unsupported";
  return <dialog ref={dialog} className="highlight-dialog audio-dialog" aria-labelledby="audio-heading" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="highlight-dialog-header"><h2 id="audio-heading" ref={heading} tabIndex={-1}>Listen to this page</h2><button className="secondary" aria-label="Close audio" onClick={onClose}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 5l14 14M19 5 5 19" /></svg></button></div>
    <p className="muted">{text.length.toLocaleString()} characters</p>
    <label htmlFor="audio-mode">Mode</label><select id="audio-mode" value={mode} disabled={!!busy} onChange={event => { stopAll(); setMode(event.target.value as Mode); setError(""); }}><option value="device">Device voice</option><option value="elevenlabs">ElevenLabs</option></select>
    {mode === "device" ? <>
      {deviceUnsupported ? <p className="error" role="alert">This browser does not support Device voice. Try ElevenLabs instead.</p> : <>
        <label htmlFor="device-voice">Voice</label><select id="device-voice" value={systemVoice} onChange={event => { device.current?.stop(); setSystemVoice(event.target.value); }} disabled={!systemVoices.length}><option value="">{systemVoices.length ? "Browser default" : "Loading voices…"}</option>{systemVoices.map(item => <option key={`${item.name}-${item.lang}`} value={item.name}>{item.name} · {item.lang}</option>)}</select>
        <label htmlFor="device-rate">Speed</label><select id="device-rate" value={rate} onChange={event => { device.current?.stop(); setRate(Number(event.target.value)); }}>{RATES.map(value => <option key={value} value={value}>{value}x</option>)}</select>
        <label className="audio-check"><input type="checkbox" checked={continueReading} onChange={event => setContinueReading(event.target.checked)} /> Continue reading</label>
        <div className="audio-actions audio-playback-actions"><button className="audio-generate" onClick={playDevice}>{speechState === "speaking" ? "Pause" : speechState === "paused" ? "Play" : "Listen to this page"}</button><button className="secondary" onClick={() => device.current?.stop()} disabled={speechState === "idle"}>Stop</button></div>
        {continueReading && <p className="muted">After each page, this turns exactly one page with epub.js and continues until the end of the book.</p>}
      </>}
    </> : <>
      <p className="muted">ElevenLabs Multilingual v2 · generation uses your account credits. Device voice is free and needs no key.</p>
      <details open={!voices.length && !source}><summary>ElevenLabs settings</summary><label htmlFor="audio-key">ElevenLabs API key</label><input id="audio-key" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={256} value={apiKey} disabled={!!busy} onChange={event => { setApiKey(event.target.value); setVoices([]); setVoice(""); setPreferredVoice(null); resetAudio(); }} /><p className="muted">Kept only until you exit or reload this reader. <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">Get a key</a></p><label htmlFor="audio-search">Find a voice <span className="muted">(optional)</span></label><input id="audio-search" value={search} maxLength={100} disabled={!!busy} onChange={event => setSearch(event.target.value)} placeholder="Name or language" /><div className="audio-actions"><button className="secondary" disabled={!apiKey.trim() || !!busy} onClick={() => void request("voices")}>{busy === "voices" ? "Loading…" : "Load voices"}</button><button className="secondary" disabled={!apiKey || !!busy} onClick={() => { setApiKey(""); setVoices([]); setVoice(""); setPreferredVoice(null); resetAudio(); }}>Forget key</button></div></details>
      {!!voices.length && <><label htmlFor="audio-voice">Voice</label><select id="audio-voice" value={voice} disabled={!!busy} onChange={event => { setVoice(event.target.value); setPreferredVoice(voices.find(item => item.id === event.target.value) || null); resetAudio(); }}>{voices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{hasMore && <p className="muted">Showing the first 100 matches.</p>}</>}
      {source ? <p className="muted" role="status">Ready. Press Play to listen to this page.</p> : <button className="audio-generate" disabled={!voice || !!busy} onClick={() => void request("speech")}>{busy === "speech" ? "Preparing page…" : "Generate page audio"}</button>}
      <audio ref={audio} controls src={source || undefined} hidden={!source} preload="metadata" aria-label="Page audio" onError={() => { if (source) setError("Audio could not be played. Try Device voice or generate it again."); }} />
      {(source || busy) && <button className="secondary audio-cancel" onClick={stopAll}>{busy ? "Cancel" : "Stop"}</button>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </dialog>;
}
