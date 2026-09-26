import { auth } from "@/lib/auth";

export class AuthorizationError extends Error {
  readonly code: "UNAUTHORIZED" | "FORBIDDEN";
  constructor(readonly status: 401 | 403) {
    super(status === 401 ? "Sign in is required." : "This account is not authorized.");
    this.name = "AuthorizationError";
    this.code = status === 401 ? "UNAUTHORIZED" : "FORBIDDEN";
  }
}

export async function requireOwner(): Promise<void> {
  const expected = process.env.AUTH_ALLOWED_GITHUB_ID;
  if (!process.env.AUTH_SECRET || !expected) throw new AuthorizationError(401);
  const session = await auth();
  if (!session?.user) throw new AuthorizationError(401);
  if (session.user.id !== expected) throw new AuthorizationError(403);
}
