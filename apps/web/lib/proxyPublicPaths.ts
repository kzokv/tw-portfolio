export function isPublicPath(pathname: string): boolean {
  return pathname === "/login"
    || pathname === "/auth/error"
    || pathname === "/invite"
    || pathname.startsWith("/invite/")
    || pathname === "/share"
    || pathname.startsWith("/share/")
    || pathname === "/api/demo"
    || pathname.startsWith("/api/demo/");
}
