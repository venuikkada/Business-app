import { NextResponse, type NextRequest } from "next/server";

/** Optional IP allow-list for the admin panel: ADMIN_ALLOWED_IPS="1.2.3.4,5.6.7.8". */
export function middleware(req: NextRequest) {
  const allowed = (process.env.ADMIN_ALLOWED_IPS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length) {
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
    if (!allowed.includes(ip)) return new NextResponse("Forbidden", { status: 403 });
  }
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api") || pathname === "/login" || pathname === "/setup-2fa" || pathname.startsWith("/_next") || pathname === "/icon.svg") return NextResponse.next();
  if (!req.cookies.get("cba_admin")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}
