import { test } from "node:test";
import assert from "node:assert/strict";
import { DeviceSpeechController } from "../src/lib/device-speech.ts";

function setup() {
  const calls = [], states = [];
  const synthesis = { cancel: () => calls.push("cancel"), pause: () => calls.push("pause"), resume: () => calls.push("resume"), speak: utterance => { calls.push(["speak", utterance]); } };
  const utterance = text => ({ text, rate: 1, voice: null, onend: null, onerror: null });
  return { calls, states, controller: new DeviceSpeechController(synthesis, utterance, (state, error) => states.push([state, error])) };
}

test("device voice plays once, pauses, resumes, and stops without stale callbacks", async () => {
  const { calls, states, controller } = setup();
  controller.play({ text: "Page one", rate: 1, continueReading: false, next: async () => null });
  const first = calls.at(-1)[1];
  assert.equal(calls.filter(call => Array.isArray(call) && call[0] === "speak").length, 1);
  controller.pause(); controller.resume(); controller.stop();
  first.onend?.();
  assert.deepEqual(calls.map(call => Array.isArray(call) ? call[0] : call), ["cancel", "speak", "pause", "resume", "cancel"]);
  assert.equal(states.at(-1)[0], "idle");
});

test("continue reading asks epub.js for exactly one following page after each end", async () => {
  const { calls, controller } = setup();
  const pages = ["Page two", null]; let nextCalls = 0;
  controller.play({ text: "Page one", rate: 1.25, continueReading: true, next: async () => { nextCalls++; return pages.shift(); } });
  calls.at(-1)[1].onend?.(); await Promise.resolve(); await Promise.resolve();
  assert.equal(nextCalls, 1); assert.equal(calls.at(-1)[1].text, "Page two"); assert.equal(calls.at(-1)[1].rate, 1.25);
  calls.at(-1)[1].onend?.(); await Promise.resolve(); await Promise.resolve();
  assert.equal(nextCalls, 2); assert.equal(calls.filter(call => Array.isArray(call) && call[0] === "speak").length, 2);
});

test("unsupported browsers and cleanup do not leave callbacks or a speech queue", () => {
  const states = [];
  const controller = new DeviceSpeechController(null, () => { throw Error("not used"); }, state => states.push(state));
  controller.play({ text: "Page", rate: 1, continueReading: false, next: async () => null });
  controller.stop();
  assert.deepEqual(states, ["unsupported", "unsupported"]);
});
