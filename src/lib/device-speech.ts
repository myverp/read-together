export type SpeechState = "idle" | "speaking" | "paused" | "unsupported" | "error";
type Synthesis = Pick<SpeechSynthesis, "cancel" | "pause" | "resume" | "speak">;
type Utterance = SpeechSynthesisUtterance;

/** Keeps exactly one browser utterance alive and makes stale callbacks harmless. */
export class DeviceSpeechController {
  private token = 0;
  private utterance: Utterance | null = null;
  private state: SpeechState = "idle";
  private readonly synthesis: Synthesis | null;
  private readonly createUtterance: (text: string) => Utterance;
  private readonly onState: (state: SpeechState, error?: string) => void;
  constructor(synthesis: Synthesis | null, createUtterance: (text: string) => Utterance, onState: (state: SpeechState, error?: string) => void) {
    this.synthesis = synthesis; this.createUtterance = createUtterance; this.onState = onState;
  }
  private emit(state: SpeechState, error?: string) { this.state = state; this.onState(state, error); }
  stop() {
    this.token++;
    if (this.utterance) { this.utterance.onend = null; this.utterance.onerror = null; }
    this.utterance = null; this.synthesis?.cancel(); this.emit(this.synthesis ? "idle" : "unsupported");
  }
  pause() { if (this.synthesis && this.utterance && this.state === "speaking") { this.synthesis.pause(); this.emit("paused"); } }
  resume() { if (this.synthesis && this.utterance && this.state === "paused") { this.synthesis.resume(); this.emit("speaking"); } }
  play({ text, voice, rate, continueReading, next }: { text: string; voice?: SpeechSynthesisVoice | null; rate: number; continueReading: boolean; next: () => Promise<string | null> }) {
    if (!this.synthesis) { this.emit("unsupported"); return; }
    this.stop(); const token = ++this.token;
    const speak = (content: string) => {
      if (token !== this.token) return;
      const utterance = this.createUtterance(content); utterance.voice = voice || null; utterance.rate = rate;
      utterance.onend = () => {
        if (token !== this.token || this.utterance !== utterance) return;
        this.utterance = null;
        if (!continueReading) { this.emit("idle"); return; }
        void next().then(nextText => { if (token !== this.token) return; if (!nextText) this.emit("idle"); else speak(nextText); }).catch(() => { if (token === this.token) this.emit("error", "Could not continue to the next page."); });
      };
      utterance.onerror = event => {
        if (token === this.token && this.utterance === utterance) { this.utterance = null; this.emit("error", event.error === "canceled" || event.error === "interrupted" ? undefined : "Device voice could not read this page."); }
      };
      this.utterance = utterance; this.synthesis!.speak(utterance); this.emit("speaking");
    };
    speak(text);
  }
  get currentState() { return this.state; }
}
