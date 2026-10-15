import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/", "/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/pricing", "/privacy", "/terms"];

/**
 * Cheap gate only: sends visitors without a session cookie to the login page.
 * Real authentication and authorisation happen on the server for every
 * request (pages and API).
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.includes(pathname) || pathname.startsWith("/p/") || pathname.startsWith("/invite")) return NextResponse.next();
  if (!req.cookies.get("cba_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname !== "/dashboard" ? `?next=${encodeURIComponent(pathname + req.nextUrl.search)}` : "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next|favicon.ico|icon.svg|manifest.webmanifest|robots.txt).*)"],
};
