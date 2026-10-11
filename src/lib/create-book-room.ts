import { api, ApiError, supabase } from "./client";
import { MAX_EPUB_BYTES } from "./types";

export type BookCreation = {
  file: File;
  checked?: boolean;
  upload?: { code: string; path: string; uploadToken: string };
  uploaded?: boolean;
  uploadAttempted?: boolean;
};

export async function createBookRoom(attempt: BookCreation, status: (message: string) => void, signal: AbortSignal) {
  const { file } = attempt;
  signal.throwIfAborted();
  if (!attempt.checked) {
    status("Checking EPUB…");
    if (!file.name.toLowerCase().endsWith(".epub") || file.size > MAX_EPUB_BYTES || !file.size) throw new Error("Choose an EPUB file up to 25 MB.");
    const { default: ePub } = await import("epubjs");
    const book = ePub();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        book.open(await file.arrayBuffer(), "binary").then(() => Promise.all([book.opened, book.ready])),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("EPUB could not be opened. Use a DRM-free EPUB.")), 15000); }),
      ]);
      attempt.checked = true;
    } finally { clearTimeout(timer); book.destroy(); }
  }
  signal.throwIfAborted();
  if (!attempt.upload) {
    status("Creating room…");
    attempt.upload = await api("/api/rooms", { name: file.name, size: file.size }, "POST", { signal });
  }
  signal.throwIfAborted();
  const upload = attempt.upload!;
  // A lost upload response may still have stored the book. Reconcile before
  // retrying the same reservation; never create another room for a known code.
  if (attempt.uploadAttempted && !attempt.uploaded) {
    status("Checking previous upload…");
    try { await api(`/api/rooms/${upload.code}`, undefined, "POST", { signal }); attempt.uploaded = true; }
    catch (error) { if (!(error instanceof ApiError) || error.status !== 409 || error.details?.takeoverRequired) throw error; }
  }
  signal.throwIfAborted();
  if (!attempt.uploaded) {
    status("Uploading EPUB…"); attempt.uploadAttempted = true;
    const { error } = await supabase().storage.from("epubs").uploadToSignedUrl(upload.path, upload.uploadToken, file, { contentType: "application/epub+zip" });
    if (error) throw error;
    attempt.uploaded = true;
  }
  // The Storage SDK cannot interrupt its transfer. Cancellation prevents
  // admission/ready marking after it resolves; cron owns unfinished cleanup.
  signal.throwIfAborted();
  return upload.code;
}
