// simple-file-json-proxy-worker.js
addEventListener('fetch', event => {
  event.respondWith(handle(event.request));
});

async function handle(request) {
  try {
    const urlObj = new URL(request.url);
    const target = urlObj.searchParams.get('url');
    if (!target) {
      return new Response(JSON.stringify({ ok:false, error:'missing url parameter' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    let targetUrl;
    try { targetUrl = new URL(target); }
    catch (e) {
      return new Response(JSON.stringify({ ok:false, error:'invalid url' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Fetch upstream (follow redirects). Keep headers minimal.
    const controller = new AbortController();
    const timeout = setTimeout(()=>controller.abort(), 30000);
    let upstream;
    try {
      upstream = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; simple-proxy/1.0)',
          'Accept': '*/*'
        },
        redirect: 'follow',
        signal: controller.signal
      });
    } catch (err) {
      clearTimeout(timeout);
      const isAbort = err.name === 'AbortError';
      return new Response(JSON.stringify({ ok:false, error: isAbort ? 'timeout' : String(err) }), {
        status: 504, headers: { 'Content-Type': 'application/json' }
      });
    }
    clearTimeout(timeout);

    // Pull useful headers
    const h = {};
    upstream.headers.forEach((v,k)=> h[k.toLowerCase()] = v);

    // If upstream returned JSON, forward parsed JSON inside our response
    const ct = h['content-type'] || '';
    if (ct.includes('application/json')) {
      try {
        const bodyJson = await upstream.json();
        return new Response(JSON.stringify({
          ok: true,
          proxied_url: targetUrl.toString(),
          upstream_status: upstream.status,
          headers: pick(h, ['content-type','content-length','content-disposition','etag']),
          body: bodyJson
        }), { status: 200, headers: {'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*'} });
      } catch (e) {
        // fallthrough to header-only response
      }
    }

    // If HTML/text small, include a short preview (limit 100k chars)
    let preview = null;
    if (ct.startsWith('text/') || ct.includes('html')) {
      try {
        const txt = await upstream.text();
        preview = txt.length > 100000 ? txt.slice(0,100000) + '\n\n---TRUNCATED---' : txt;
      } catch (e) {
        preview = null;
      }
    }

    // For binaries (videos/zips), don't stream here; return metadata (content-length/type) as JSON
    const output = {
      ok: true,
      proxied_url: targetUrl.toString(),
      upstream_status: upstream.status,
      headers: pick(h, ['content-type','content-length','content-disposition','etag','server','cf-ray']),
      preview: preview
    };

    return new Response(JSON.stringify(output, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok:false, error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k]) out[k] = obj[k];
  return out;
}
  
