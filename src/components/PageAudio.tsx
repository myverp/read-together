"use client";
import { useEffect, useRef, useState } from "react";
import { readerToken } from "@/lib/client";

export type AudioVoice = { id: string; name: string };
export default function PageAudio({ code, text, apiKey, setApiKey, preferredVoice, setPreferredVoice, onClose }: {
  code: string; text: string; apiKey: string; setApiKey: (key: string) => void; onClose: () => void;
  preferredVoice: AudioVoice | null; setPreferredVoice: (voice: AudioVoice | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const pending = useRef<AbortController | null>(null);
  const objectUrl = useRef("");
  const [voices, setVoices] = useState<AudioVoice[]>(preferredVoice ? [preferredVoice] : []);
  const [voice, setVoice] = useState(preferredVoice?.id || "");
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<"voices" | "speech" | null>(null);
  const [error, setError] = useState("");
  const [source, setSource] = useState("");
  useEffect(() => {
    dialog.current?.showModal(); heading.current?.focus();
    const player = audio.current;
    return () => {
      pending.current?.abort(); player?.pause();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);
  function resetAudio() {
    audio.current?.pause(); setSource("");
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = "";
  }
  function cancel() { pending.current?.abort(); pending.current = null; setBusy(null); }
  async function request(action: "voices" | "speech") {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller; setBusy(action); setError("");
    if (action === "speech") resetAudio();
    try {
      const response = await fetch(`/api/rooms/${code}/speech`, {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${readerToken()}`, "x-elevenlabs-key": apiKey.trim() },
        body: JSON.stringify(action === "voices" ? { action, search } : { action, voice, text }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "Audio request failed. Please try again.");
      }
      if (action === "voices") {
        const result = await response.json();
        if (controller.signal.aborted) return;
        setVoices(result.voices); setHasMore(result.hasMore);
        setVoice(result.voices[0]?.id || ""); setPreferredVoice(result.voices[0] || null); resetAudio();
        if (!result.voices.length) setError("No voices found. Try another search or add a voice in ElevenLabs.");
      } else {
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (!blob.size || !blob.type.startsWith("audio/")) throw new Error("The audio response was invalid. Please try again.");
        objectUrl.current = URL.createObjectURL(blob); setSource(objectUrl.current);
        // iOS may block play() after a fetch; use the native player's Play button.
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error && e.name !== "TimeoutError" ? e.message : "Audio generation timed out. Please try again.");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(null); }
    }
  }
  return <dialog ref={dialog} className="highlight-dialog audio-dialog" aria-labelledby="audio-heading" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="highlight-dialog-header">
      <h2 id="audio-heading" ref={heading} tabIndex={-1}>Listen to this page</h2>
      <button className="secondary" aria-label="Close audio" onClick={onClose}>×</button>
    </div>
    <p className="muted">{text.length.toLocaleString()} characters · ElevenLabs Multilingual v2</p>
    <details open={!voices.length && !source}>
      <summary>Audio settings</summary>
      <label htmlFor="audio-key">ElevenLabs API key</label>
      <input id="audio-key" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={256} value={apiKey} disabled={!!busy}
        onChange={event => { setApiKey(event.target.value); setVoices([]); setVoice(""); setPreferredVoice(null); resetAudio(); }} />
      <p className="muted">Kept only until you exit or reload this reader. Use a key with Text to Speech and Voices read permissions and a spending limit. <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">Get a key</a></p>
      <label htmlFor="audio-search">Find a voice <span className="muted">(optional)</span></label>
      <input id="audio-search" value={search} maxLength={100} disabled={!!busy} onChange={event => setSearch(event.target.value)} placeholder="Name or language" />
      <div className="audio-actions">
        <button className="secondary" disabled={!apiKey.trim() || !!busy} onClick={() => void request("voices")}>{busy === "voices" ? "Loading…" : "Load voices"}</button>
        <button className="secondary" disabled={!apiKey || !!busy} onClick={() => { setApiKey(""); setVoices([]); setVoice(""); setPreferredVoice(null); resetAudio(); }}>Forget key</button>
      </div>
    </details>
    {!!voices.length && <>
      <label htmlFor="audio-voice">Voice</label>
      <select id="audio-voice" value={voice} disabled={!!busy} onChange={event => { setVoice(event.target.value); setPreferredVoice(voices.find(item => item.id === event.target.value) || null); resetAudio(); }}>
        {voices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {hasMore && <p className="muted">Showing the first 100 matches. Search in Audio settings to find another voice.</p>}
    </>}
    <p className="muted">Generating sends this page’s text to ElevenLabs and uses your account’s credits. Audio stays in this window.</p>
    {source ? <p className="muted" role="status">Ready. Press Play to listen to the whole page.</p> : <button className="audio-generate" disabled={!voice || !!busy} onClick={() => void request("speech")}>{busy === "speech" ? "Preparing page…" : "Generate page audio"}</button>}
    <audio ref={audio} controls src={source || undefined} hidden={!source} preload="metadata" aria-label="Page audio" onError={() => { if (source) setError("Audio could not be played. Try generating it again."); }} />
    {source && error && <button className="secondary" onClick={resetAudio}>Clear audio</button>}
    {busy && <button className="secondary audio-cancel" onClick={cancel}>Cancel</button>}
    {error && <p className="error" role="alert">{error}</p>}
  </dialog>;
}
