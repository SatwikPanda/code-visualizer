import { cookies } from "next/headers";
import { desktopTokenMatches } from "../../../lib/desktop-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const expected = process.env.CODEVIZ_DESKTOP_TOKEN;
  if (!expected) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  if (
    !desktopTokenMatches(expected, url.searchParams.get("token") || undefined)
  )
    return new Response("Unauthorized", { status: 401 });
  (await cookies()).set("codeviz-desktop", expected, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
  });
  return new Response(null, {
    status: 303,
    headers: {
      // Next normalizes request.url to localhost in the standalone server.
      // A relative redirect preserves the actual 127.0.0.1 WebView origin.
      location: "/",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
