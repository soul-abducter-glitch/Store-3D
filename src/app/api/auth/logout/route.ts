const cookiePrefix = process.env.PAYLOAD_COOKIE_PREFIX || "payload";
const tokenName = `${cookiePrefix}-token`;
const expires = "Thu, 01 Jan 1970 00:00:00 GMT";

const buildCookie = (options: string[]) =>
  `${tokenName}=; Path=/; Expires=${expires}; Max-Age=0; HttpOnly${options.length ? `; ${options.join("; ")}` : ""}`;

export async function POST() {
  const headers = new Headers();
  headers.append("Set-Cookie", buildCookie([]));
  headers.append("Set-Cookie", buildCookie(["SameSite=Lax"]));
  headers.append("Set-Cookie", buildCookie(["SameSite=Strict"]));
  headers.append("Set-Cookie", buildCookie(["Secure"]));
  headers.append("Set-Cookie", buildCookie(["Secure", "SameSite=Strict"]));
  headers.append("Set-Cookie", buildCookie(["Secure", "SameSite=Lax"]));

  return Response.json({ ok: true }, { headers });
}
