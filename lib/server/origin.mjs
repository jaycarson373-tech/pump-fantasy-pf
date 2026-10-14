function parseHttpOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || localHttp ? url.origin : null;
  } catch {
    return null;
  }
}

function configuredOrigins(env) {
  return new Set([
    parseHttpOrigin(env.NEXT_PUBLIC_SITE_URL),
    "https://pump-fantasy-pf.vercel.app",
    ...(env.PUMP_FANTASY_ALLOWED_ORIGINS || "").split(",").map((value) => parseHttpOrigin(value.trim())),
  ].filter(Boolean));
}

export function siteOriginHost(request, env = process.env) {
  const origin = request.headers.get("origin");
  if (!origin) return parseHttpOrigin(env.NEXT_PUBLIC_SITE_URL)
    ? new URL(env.NEXT_PUBLIC_SITE_URL).host
    : new URL(request.url).host;
  const originValue = parseHttpOrigin(origin);
  if (!originValue) return null;
  if (originValue === new URL(request.url).origin || configuredOrigins(env).has(originValue)) return new URL(originValue).host;
  return null;
}

export function sameSiteOrigin(request, env = process.env) {
  return !request.headers.get("origin") || siteOriginHost(request, env) !== null;
}
