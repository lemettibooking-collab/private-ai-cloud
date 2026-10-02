// AI-038.2a: the single Auth.js instance (server-only). `handlers` serve only the Auth.js
// authentication route; `auth()` returns the verified server-side session for the current request.
import "server-only";
import NextAuth from "next-auth";
import { createPacAuthConfig } from "./auth-config";

export const { handlers, auth } = NextAuth(createPacAuthConfig());
