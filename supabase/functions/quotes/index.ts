// Supabase Edge Function "quotes"
// Returns the latest price for each ticker, from Yahoo Finance (free, no key, about 15 minutes delayed).
// Request:  POST { "symbols": ["MSFT", "SPUS", "NBK.KW"] }
// Response: { "MSFT": { "price": 457.6, "currency": "USD", "time": 1791576000 }, ... }
// Kuwait stocks (".KW") come back in fils (currency "KWF"); the app divides by 1000.
// Only signed-in users of the app can call it (Supabase checks the login token).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function quote(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return null;
  const meta = (await res.json())?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== "number") return null;
  return { price: meta.regularMarketPrice, currency: meta.currency, time: meta.regularMarketTime };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const body = await req.json().catch(() => ({}));
  const symbols: string[] = [...new Set<string>((Array.isArray(body.symbols) ? body.symbols : []).map(String))]
    .filter((s) => /^[A-Za-z0-9.=^-]{1,20}$/.test(s))
    .slice(0, 100);

  const out: Record<string, unknown> = {};
  // A few at a time, to stay polite to Yahoo.
  for (let i = 0; i < symbols.length; i += 5) {
    await Promise.all(symbols.slice(i, i + 5).map(async (s) => {
      try {
        const q = await quote(s);
        if (q) out[s] = q;
      } catch {
        // skip this symbol; the app keeps its last known price
      }
    }));
  }
  return new Response(JSON.stringify(out), { headers: { ...CORS, "Content-Type": "application/json" } });
});
