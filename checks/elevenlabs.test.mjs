import { test } from "node:test";
import assert from "node:assert/strict";
import { elevenlabs } from "../src/lib/elevenlabs.ts";
const key = "test-key-not-a-real-secret";

test("speech forwards only the specified text, model and key to the fixed provider", async t => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.elevenlabs.io/v1/text-to-speech/voice123?output_format=mp3_44100_128");
    assert.equal(options.headers["xi-api-key"], key);
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.deepEqual(JSON.parse(options.body), { text: "Привіт, світе.", model_id: "eleven_multilingual_v2" });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg", "provider-secret": "private" } });
  });
  const response = await elevenlabs(key, { text: "Привіт, світе.", voice: "voice123" }, new AbortController().signal);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("provider-secret"), null);
  assert.equal((await response.arrayBuffer()).byteLength, 3);
});

test("provider errors never echo private payloads and do not automatically retry billing requests", async t => {
  const mock = t.mock.method(globalThis, "fetch", async () => new Response(`private book ${key}`, { status: 429 }));
  await assert.rejects(elevenlabs(key, { text: "book", voice: "voice" }, new AbortController().signal), error => error.status === 429 && !error.message.includes(key) && /quota/.test(error.message));
  assert.equal(mock.mock.callCount(), 1);
});

test("invalid text and path values are rejected before sending anything", async t => {
  const mock = t.mock.method(globalThis, "fetch", () => { throw Error("must not call"); });
  for (const input of [{ text: "", voice: "a" }, { text: "x".repeat(10001), voice: "a" }, { text: "hello", voice: "../bad" }]) {
    await assert.rejects(elevenlabs(key, input, new AbortController().signal));
  }
  assert.equal(mock.mock.callCount(), 0);
});

test("voices response contains only display data and supports encoded search", async t => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.match(url, /search=uk%26test$/);
    return Response.json({ voices: [{ voice_id: "one", name: "Voice", private: key }], has_more: true });
  });
  const response = await elevenlabs(key, { search: "uk&test" }, new AbortController().signal);
  assert.deepEqual(await response.json(), { voices: [{ id: "one", name: "Voice" }], hasMore: true });
});

test("cancellation reaches the provider", async t => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))));
  const operation = elevenlabs(key, { text: "hello", voice: "voice" }, controller.signal);
  controller.abort();
  await assert.rejects(operation, /could not be reached/);
});
