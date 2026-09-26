"use client";

import { signIn } from "next-auth/react";

export function SignInForm() {
  return <button className="primary-button" type="button" onClick={() => void signIn("github", { callbackUrl: "/" })}>Continue with GitHub</button>;
}
