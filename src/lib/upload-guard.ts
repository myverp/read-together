import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export function roomCreationScope(request: Request, guestHash: string, secret: string, onVercel: boolean) {
  // Vercel overwrites this header, so callers cannot choose a new address per request.
  const forwarded = onVercel ? request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for") : null;
  const ip = forwarded?.split(",")[0]?.trim();
  if (onVercel && (!ip || !isIP(ip))) return null;
  return createHmac("sha256", secret).update(ip ? `ip:${ip}` : `local:${guestHash}`).digest("hex");
}
