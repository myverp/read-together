"use client";
import Link from "next/link";

export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <main className="home"><h1>Could not open this page</h1><p>Try again, or return home to reopen your room.</p><button onClick={retry}>Try again</button><p><Link href="/">Return to Read together</Link></p></main>;
}
