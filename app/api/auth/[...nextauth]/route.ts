// AI-038.2a: the one authentication HTTP surface (Auth.js sign-in / callback / sign-out / session).
// No PAC runtime, Owner read or workflow API is exposed here.
import { handlers } from "@/lib/auth/next-auth.server";

export const { GET, POST } = handlers;
