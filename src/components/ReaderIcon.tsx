export type ReaderIconName = "menu" | "exit" | "contents" | "listen" | "settings" | "invite" | "partner" | "info" | "prev" | "next" | "draw" | "eye";

const paths: Record<ReaderIconName, string> = {
  menu: "M4 6h16M4 12h16M4 18h16",
  exit: "M14 8V3H4v18h10v-5M10 12h12m-4-4 4 4-4 4M11 7v.01",
  contents: "M8 6h12M8 12h12M8 18h12M3 6h.01M3 12h.01M3 18h.01",
  listen: "M4 14v-3a8 8 0 0 1 16 0v3M4 12H3v8h4v-8H4m16 0h1v8h-4v-8h3",
  settings: "M3 7h5m6 0h7M3 17h10m6 0h2M8 7a3 3 0 1 0 6 0 3 3 0 1 0-6 0m5 10a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
  invite: "M10 11a4 4 0 1 0 0-8 4 4 0 1 0 0 8M3 21v-3a7 7 0 0 1 14 0v3H3M20 8v6m-3-3h6",
  partner: "M8 11a4 4 0 1 0 0-8 4 4 0 1 0 0 8M2 21v-3a6 6 0 0 1 12 0v3M18 11a4 4 0 1 0 0-8 4 4 0 1 0 0 8M16 13a6 6 0 0 1 6 5v3",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 1 0 0 20M12 11v6M12 7v.01",
  prev: "M21 12H3m7-7-7 7 7 7",
  next: "M3 12h18m-7-7 7 7-7 7",
  draw: "m4 20 4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Zm10.5-13.5 3 3",
  eye: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm7 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
};

export default function ReaderIcon({ name, hidden }: { name: ReaderIconName; hidden?: boolean }) {
  return <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={paths[name]} />{hidden && <path d="M3 21 21 3" />}
  </svg>;
}
