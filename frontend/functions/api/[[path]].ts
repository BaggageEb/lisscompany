export async function onRequest(context: {
  request: Request;
}): Promise<Response> {
  const incomingUrl = new URL(context.request.url);
  const backendUrl = new URL(
    incomingUrl.pathname + incomingUrl.search,
    "https://lisscompany.onrender.com"
  );

  const headers = new Headers(context.request.headers);
  headers.delete("host");

  const proxyRequest = new Request(backendUrl.toString(), {
    method: context.request.method,
    headers,
    body: ["GET", "HEAD"].includes(context.request.method)
      ? undefined
      : context.request.body,
    redirect: "manual",
  });

  return fetch(proxyRequest);
}
