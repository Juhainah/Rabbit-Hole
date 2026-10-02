// Node's built-in fetch (undici) can throw from inside a socket callback when a site closes its
// connection mid-reply ("AssertionError: false == true" in Parser.finish). Nothing can catch that,
// so one odd website would take the whole server down with every dig in progress. Those internal
// errors only cost the one request that hit them; anything else still stops the process.
process.on('uncaughtException', (e) => {
  if (/undici/.test(String((e as Error)?.stack ?? ''))) {
    console.warn(`[guard] ignored a network library error: ${(e as Error).message}`);
    return;
  }
  console.error(e);
  process.exit(1);
});
