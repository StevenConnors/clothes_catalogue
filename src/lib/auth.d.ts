import "next-auth";

declare module "next-auth" {
  interface Session {
    user: { id: string } & NonNullable<Session["user"]>;
  }
}
declare module "next-auth/jwt" {
  interface JWT { githubId?: string }
}
