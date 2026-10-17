import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (
    !["languages", "analyses", "runs"].includes(path[0]) ||
    path.some((p) => !/^[-\w]+$/.test(p))
  )
    return Response.json({ error: "Not found" }, { status: 404 });
  const jar = await cookies();
  let owner = jar.get("codeviz-session")?.value;
  if (!owner || !/^[-\w]{36}$/.test(owner)) {
    owner = randomUUID();
    jar.set("codeviz-session", owner, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 86400,
      secure:
        process.env.NODE_ENV === "production" &&
        request.url.startsWith("https:"),
    });
  }
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  const publicOrigin = `${requestUrl.protocol}//${request.headers.get("host") || requestUrl.host}`;
  if (
    !["GET", "HEAD"].includes(request.method) &&
    origin &&
    origin !== publicOrigin
  )
    return Response.json({ error: "Request origin rejected" }, { status: 403 });
  if (!process.env.RUNNER_SECRET)
    return Response.json(
      { error: "Start the app with npm run dev or npm run dev:local." },
      { status: 503 },
    );
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 140000)
      return Response.json({ error: "Request too large" }, { status: 413 });
    const text = ["GET", "HEAD"].includes(request.method)
      ? undefined
      : await request.text();
    if (text && Buffer.byteLength(text) > 140000)
      return Response.json({ error: "Request too large" }, { status: 413 });
    const response = await fetch(
      `${process.env.RUNNER_BASE_URL || `http://127.0.0.1:${process.env.RUNNER_PORT || 4317}`}/${path.join("/")}${new URL(request.url).search}`,
      {
        method: request.method,
        headers: {
          "content-type": "application/json",
          "x-runner-key": process.env.RUNNER_SECRET,
          "x-owner": owner,
        },
        body: text,
        cache: "no-store",
        signal: request.signal,
      },
    );
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") || "application/json",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        ...(path.at(-1) === "export"
          ? {
              "Content-Disposition": `attachment; filename="codeviz-${path[1]}.json"`,
            }
          : {}),
      },
    });
  } catch {
    return Response.json(
      {
        error:
          "The execution service is unavailable. Check the terminal and run npm run doctor.",
      },
      { status: 503 },
    );
  }
}
export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
