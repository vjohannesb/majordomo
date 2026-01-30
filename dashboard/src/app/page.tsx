import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SERVER_URL } from "@/lib/api";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="text-center max-w-md">
        <h1 className="text-4xl font-bold mb-4">Majordomo</h1>
        <p className="text-[var(--muted-foreground)] mb-8">
          Your personal AI assistant - everywhere.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button asChild size="lg">
            <a href={`${SERVER_URL}/auth/google`}>Sign in with Google</a>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/dashboard">Go to Dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
