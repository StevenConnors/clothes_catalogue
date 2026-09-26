export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SignInForm } from "@/components/wardrobe/sign-in-form";

export default async function SignInPage() {
  const configured = Boolean(process.env.AUTH_SECRET && process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET && process.env.AUTH_ALLOWED_GITHUB_ID);
  if (!configured) return <main className="sign-in-page"><div className="sign-in-card"><span className="brand-mark">W</span><p className="eyebrow">SETUP REQUIRED</p><h1>Sign-in isn’t ready yet.</h1><p className="sign-in-copy">Configure the GitHub OAuth credentials and allowed account in the environment to enable private access.</p><button className="primary-button" type="button" disabled>Sign-in unavailable</button></div></main>;
  const session = await auth();
  if (session?.user?.id === process.env.AUTH_ALLOWED_GITHUB_ID) redirect("/");
  if (session?.user) return <main className="state-page"><h1>Access denied</h1><p>This account is not authorized to view the wardrobe.</p></main>;
  return <main className="sign-in-page"><div className="sign-in-card"><span className="brand-mark">W</span><p className="eyebrow">A LITTLE MORE ROOM</p><h1>Your wardrobe,<br />all in one place.</h1><p className="sign-in-copy">A private catalogue of the pieces you already own.</p><SignInForm /><p className="privacy-note">Private to your account</p></div></main>;
}
