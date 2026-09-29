import Link from "next/link";

export default function NotFound() {
  return <main className="home"><h1>Page not found</h1><p>This address is not a valid page or room invitation.</p><Link href="/">Return to Read together</Link></main>;
}
