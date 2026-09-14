// Only called by the server route. Never return raw provider errors or headers.
export class SpeechError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export async function elevenlabs(key: string, input: { text?: string; voice?: string; search?: string }, signal: AbortSignal) {
  if (!/^[\x21-\x7e]{16,256}$/.test(key)) throw new SpeechError("Enter a valid ElevenLabs API key.");
  const speaking = input.text !== undefined;
  if (speaking && (typeof input.text !== "string" || !input.text.trim() || input.text.length > 10000)) throw new SpeechError("Choose a text page with up to 10,000 characters.");
  if (speaking && (typeof input.voice !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.voice))) throw new SpeechError("Choose a voice first.");
  const path = speaking ? `/v1/text-to-speech/${input.voice}?output_format=mp3_44100_128` : `/v2/voices?page_size=100&search=${encodeURIComponent((input.search || "").slice(0,100))}`;
  let response: Response;
  try {
    response = await fetch(`https://api.elevenlabs.io${path}`, {
      method: speaking ? "POST" : "GET", cache: "no-store", redirect: "error", signal,
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: speaking ? JSON.stringify({ text: input.text, model_id: "eleven_multilingual_v2" }) : undefined,
    });
  } catch { throw new SpeechError("Audio service could not be reached. Please try again.", 503); }
  if (!response.ok) {
    await response.body?.cancel();
    const message = response.status === 401 ? "ElevenLabs rejected this key. Check or replace it." :
      response.status === 403 ? "This key cannot access the voice or service. Enable Text to Speech and Voices read permissions." :
      response.status === 429 ? "ElevenLabs quota or request limit reached. Check your plan or try later." :
      response.status === 402 ? "ElevenLabs credits are exhausted. Check your account." :
      response.status === 404 ? "This voice is no longer available. Choose another voice." :
      "ElevenLabs could not generate this page. Check your credits and voice, then try again.";
    throw new SpeechError(message, response.status >= 500 ? 503 : response.status);
  }
  if (speaking) {
    if (!response.headers.get("content-type")?.startsWith("audio/")) throw new SpeechError("ElevenLabs returned an invalid audio response.", 502);
    const bytes = await response.arrayBuffer();
    if (!bytes.byteLength) throw new SpeechError("ElevenLabs returned empty audio. Please try again.", 502);
    return new Response(bytes, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  const result = await response.json();
  const voices = (Array.isArray(result.voices) ? result.voices : []).filter((voice: { voice_id?: unknown; name?: unknown }) => typeof voice.voice_id === "string" && typeof voice.name === "string")
    .map((voice: { voice_id: string; name: string }) => ({ id: voice.voice_id, name: voice.name }));
  return Response.json({ voices, hasMore: !!result.has_more }, { headers: { "Cache-Control": "no-store" } });
}
