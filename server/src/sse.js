// Server-Sent Events helper for streaming routes. Call once per request, after
// validation (errors thrown before this can still become a normal JSON 4xx).

export function openSse(_req, res) {
  res.status(200).set({
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no', // tell Nginx not to buffer this response
  });
  res.flushHeaders();

  // Comment lines keep proxies from closing an idle stream while the model
  // is still loading or thinking before the first token.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15_000);

  // Listen on `res`, not `req`: since Node 16 the request emits 'close' as
  // soon as its body has been consumed, which would abort every call.
  const ac = new AbortController();
  res.on('close', () => {
    clearInterval(heartbeat);
    if (!res.writableFinished) ac.abort(); // browser went away mid-stream
  });

  return {
    signal: ac.signal, // aborted when the browser goes away; pass it to the model call
    send(event, data) {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`);
    },
    close() {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    },
  };
}
