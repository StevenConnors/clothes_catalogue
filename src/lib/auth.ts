import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";

const ownerId = () => process.env.AUTH_ALLOWED_GITHUB_ID;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ profile }) {
      const allowed = ownerId();
      return Boolean(allowed && profile?.id != null && String(profile.id) === allowed);
    },
    async jwt({ token, profile }) {
      if (profile?.id != null) token.githubId = String(profile.id);
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.githubId === "string") {
        session.user.id = token.githubId;
      }
      return session;
    },
  },
});
