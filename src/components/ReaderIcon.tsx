export type ReaderIconName = "close" | "highlight" | "search" | "menu" | "exit" | "contents" | "notes" | "listen" | "settings" | "invite" | "partner" | "info" | "prev" | "next" | "draw" | "eye";

const paths: Record<ReaderIconName, string> = {
  close: "M6 6l12 12M18 6 6 18",
  highlight: "m9 14 8-10 5 4-8 10-5-4Zm0 0-4 5 4 1 5-2M3 22h13",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-1.7 4.3L21 21",
  menu: "M4 6h16M4 12h16M4 18h16",
  exit: "M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M9 12h12m-4-4 4 4-4 4",
  contents: "M12 6.5C9.5 4.7 6.2 4.2 3 5v14c3.2-.8 6.5-.3 9 1.5 2.5-1.8 5.8-2.3 9-1.5V5c-3.2-.8-6.5-.3-9 1.5Zm0 0v14M6.5 9h2M15.5 9h2M6.5 12.5h2M15.5 12.5h2",
  notes: "M14 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9l-7 7ZM14 21v-5a2 2 0 0 1 2-2h5M7 8h10M7 12h5",
  listen: "M3 14v-3a9 9 0 0 1 18 0v3M5 12h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2Zm14 0h-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2Z",
  settings: "M3 7h5m6 0h7M3 17h10m6 0h2M8 7a3 3 0 1 0 6 0 3 3 0 1 0-6 0m5 10a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
  invite: "M10 11a4 4 0 1 0 0-8 4 4 0 1 0 0 8M3 21v-3a7 7 0 0 1 14 0v3H3M20 8v6m-3-3h6",
  partner: "M12 7.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0ZM2 20v-1.5a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5V20M16 4.2a3.5 3.5 0 0 1 0 6.6M18 14a5 5 0 0 1 4 4.9V20",
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
