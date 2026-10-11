import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import RoomEntry from "@/components/RoomEntry";
import { ROOM_CODE, roomPath } from "@/lib/room-invitation";

export const metadata: Metadata = {
  title: "Reading room · Read together",
  description: "Read an EPUB with someone, at your own pace.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const normalized = code.toUpperCase();
  if (!ROOM_CODE.test(normalized)) notFound();
  if (code !== normalized) redirect(roomPath(normalized));
  return <RoomEntry key={normalized} code={normalized} />;
}
