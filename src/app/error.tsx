"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="state-page"><h1>Something went wrong</h1><p>Your wardrobe couldn’t be loaded. Please try again.</p><button className="primary-button" onClick={() => reset()}>Try again</button></main>;
}
