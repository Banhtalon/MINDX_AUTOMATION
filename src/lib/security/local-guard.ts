import { NextResponse } from "next/server";

const ALLOWED_HOSTS = ["127.0.0.1", "localhost"];

/**
 * Validates that an incoming HTTP request originated strictly from the local machine (127.0.0.1 or localhost).
 * Prevents DNS rebinding and cross-origin attack vectors targeting the local agent.
 */
export function isLocalRequest(req: Request): boolean {
  const url = new URL(req.url);
  const hostname = url.hostname.toLowerCase();

  // 1. Check URL hostname
  if (!ALLOWED_HOSTS.includes(hostname)) {
    return false;
  }

  // 2. Check Host header
  const hostHeader = req.headers.get("host")?.toLowerCase() || "";
  const hostDomain = hostHeader.split(":")[0];
  if (!ALLOWED_HOSTS.includes(hostDomain)) {
    return false;
  }

  // 3. Check Origin header (if present on POST/PUT requests)
  const origin = req.headers.get("origin")?.toLowerCase();
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (!ALLOWED_HOSTS.includes(originUrl.hostname)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Asserts local request or returns a 403 Forbidden Response.
 */
export function validateLocalRequest(req: Request): NextResponse | null {
  if (!isLocalRequest(req)) {
    return NextResponse.json(
      {
        success: false,
        error: "[Security] Access Denied: Server only accepts requests from 127.0.0.1 or localhost.",
      },
      { status: 403 }
    );
  }
  return null;
}
