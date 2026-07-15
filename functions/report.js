// Stores and serves the latest admissions report on Cloudflare Pages.
//
//   GET  /report   -> returns the latest saved report JSON
//                     (HTTP 204 if nothing has been published yet)
//   POST /report   -> saves a new report. Requires the shared password in the
//                     "X-Upload-Password" header. Body is the parsed report JSON
//                     produced by the dashboard.
//
// Storage: Cloudflare Workers KV. In the dashboard you create a KV namespace and
// bind it to this Pages project with the variable name `REPORTS_KV`
// (Settings -> Bindings -> Add -> KV namespace). The binding is then available
// on context.env.REPORTS_KV inside the functions below.
//
// Password: read from the environment variable UPLOAD_PASSWORD, set in the
// Pages project's Settings -> Variables and Secrets. Never sent to the browser.
//
// Consistency note: KV is eventually consistent; an update may take a few seconds
// (occasionally up to ~60s) to be visible everywhere. Fine for a daily report.

const KEY = 'latest-report';

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------- READ ----------
export async function onRequestGet(context) {
  const kv = context.env && context.env.REPORTS_KV;
  if (!kv) return json({ error: 'KV namespace not bound as REPORTS_KV' }, 500);

  let data = null;
  try {
    data = await kv.get(KEY, 'json'); // returns null if missing
  } catch (e) {
    data = null;
  }
  if (!data) return new Response(null, { status: 204 }); // nothing published yet

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// ---------- WRITE ----------
export async function onRequestPost(context) {
  const kv = context.env && context.env.REPORTS_KV;
  if (!kv) return json({ error: 'KV namespace not bound as REPORTS_KV' }, 500);

  const expected = (context.env && context.env.UPLOAD_PASSWORD) || '';
  const provided = context.request.headers.get('x-upload-password') || '';

  if (!expected || provided !== expected) {
    return json({ error: 'unauthorized' }, 401);
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch (e) {
    return json({ error: 'invalid JSON' }, 400);
  }

  if (!payload || typeof payload !== 'object' || !payload.stages) {
    return json({ error: 'not a report payload' }, 400);
  }

  payload.publishedAt = new Date().toISOString();

  try {
    await kv.put(KEY, JSON.stringify(payload));
  } catch (e) {
    return json({ error: 'could not save: ' + e.message }, 500);
  }

  return json({ ok: true, publishedAt: payload.publishedAt }, 200);
}

// ---------- anything else ----------
export async function onRequest(context) {
  const m = context.request.method;
  if (m === 'GET') return onRequestGet(context);
  if (m === 'POST') return onRequestPost(context);
  return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, POST' } });
}
