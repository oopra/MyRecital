// functions/api/image.js — the image-model proxy.
//
// Two providers cannot be called from a browser at all (no CORS on their APIs), so this
// small function stands in front of them. It exists for three reasons, in order of how
// much they matter:
//   1. It keeps API keys server-side, in environment variables, out of the page.
//   2. It gets past the missing CORS headers.
//   3. It returns image BYTES, always. Replicate answers with a URL on its own CDN, and
//      an <img> from a foreign host can taint the canvas — which would make the reel
//      unrecordable. Resolving the URL here means the browser only ever sees base64.
//
// Deploys as a Cloudflare Pages Function at /api/image. On Vercel, move it to
// api/image.js and export `export default function handler(req, res)` instead — the body
// of each adapter is unchanged.
//
// Environment variables (set whichever providers you use):
//   OPENAI_API_KEY, REPLICATE_API_TOKEN, GEMINI_API_KEY
//
// If none is set for the requested provider, the function falls back to a key sent in the
// request body — which is how someone can try it on a preview deploy without configuring
// anything. That is a deliberate convenience, and it is why the response never echoes a
// key back and why the error paths below never include the request body.

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function bad(status, message) {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

// Base64 for arbitrary bytes, chunked because String.fromCharCode(...bigArray) blows the
// call stack on anything megabyte-sized.
function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch the generated image (HTTP ${res.status})`);
  const buffer = new Uint8Array(await res.arrayBuffer());
  return { b64: bytesToBase64(buffer), mime: res.headers.get('content-type') || 'image/png' };
}

async function readError(res, provider) {
  let detail = '';
  try { detail = (await res.text()).slice(0, 400); } catch { /* nothing readable */ }
  return `${provider} responded ${res.status}${detail ? ': ' + detail : ''}`;
}

// gpt-image-1 sizes are fixed; map the reel's aspect onto the nearest one it accepts.
function openaiSize(aspect) {
  if (aspect === '16:9') return '1536x1024';
  if (aspect === '1:1') return '1024x1024';
  return '1024x1536';
}

async function runOpenAI(body, key) {
  // With reference images the request has to be multipart against /images/edits; without
  // them it is plain JSON against /images/generations.
  if (body.reference && body.reference.base64) {
    const form = new FormData();
    form.append('model', body.model || 'gpt-image-1');
    form.append('prompt', body.prompt);
    form.append('size', openaiSize(body.aspect));
    form.append('n', '1');
    const bytes = Uint8Array.from(atob(body.reference.base64), (c) => c.charCodeAt(0));
    form.append('image[]', new Blob([bytes], { type: body.reference.mime || 'image/png' }), 'reference.png');
    const res = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form
    });
    if (!res.ok) throw new Error(await readError(res, 'OpenAI'));
    return pickOpenAIImage(await res.json());
  }
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, ...JSON_HEADERS },
    body: JSON.stringify({
      model: body.model || 'gpt-image-1',
      prompt: body.prompt,
      size: openaiSize(body.aspect),
      n: 1
    })
  });
  if (!res.ok) throw new Error(await readError(res, 'OpenAI'));
  return pickOpenAIImage(await res.json());
}

async function pickOpenAIImage(json) {
  const entry = json && json.data && json.data[0];
  if (!entry) throw new Error('OpenAI returned no image data');
  if (entry.b64_json) return { b64: entry.b64_json, mime: 'image/png' };
  if (entry.url) return fetchAsBase64(entry.url);
  throw new Error('OpenAI returned neither b64_json nor url');
}

async function runReplicate(body, key) {
  const model = body.model || 'black-forest-labs/flux-1.1-pro';
  // `Prefer: wait` makes this synchronous, so the function does not have to poll — but
  // it can still time out and come back "processing", which is handled below.
  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, Prefer: 'wait', ...JSON_HEADERS },
    body: JSON.stringify({
      input: {
        prompt: body.prompt,
        aspect_ratio: body.aspect === '16:9' ? '16:9' : body.aspect === '1:1' ? '1:1' : '9:16',
        output_format: 'png',
        safety_tolerance: 2
      }
    })
  });
  if (!res.ok) throw new Error(await readError(res, 'Replicate'));
  const json = await res.json();
  if (json.error) throw new Error('Replicate: ' + json.error);
  const status = String(json.status || '');
  if (status && !/succe/i.test(status)) {
    throw new Error(`Replicate did not finish in time (status "${status}"). Try a faster model such as flux-schnell.`);
  }
  const output = Array.isArray(json.output) ? json.output[0] : json.output;
  if (!output) throw new Error('Replicate returned no output');
  return fetchAsBase64(output);
}

async function runGemini(body, key) {
  const input = [{ type: 'text', text: body.prompt }];
  if (body.reference && body.reference.base64) {
    input.push({ type: 'image', mime_type: body.reference.mime || 'image/png', data: body.reference.base64 });
  }
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': key, ...JSON_HEADERS },
    body: JSON.stringify({
      model: body.model || 'gemini-3.1-flash-image',
      input,
      response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: body.aspect, image_size: '1K' }
    })
  });
  if (!res.ok) throw new Error(await readError(res, 'Gemini'));
  const json = await res.json();
  const b64 = findImageData(json);
  if (!b64) throw new Error('Gemini returned no image');
  return { b64, mime: 'image/jpeg' };
}

// Same tolerant walk as the browser adapter: providers move these fields between versions.
function findImageData(node, depth = 0) {
  if (!node || depth > 6 || typeof node === 'string') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findImageData(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const key of ['b64_json', 'imageBytes', 'image_bytes']) {
    if (typeof node[key] === 'string' && node[key].length > 100) return node[key];
  }
  if (typeof node.data === 'string' && node.data.length > 100) return node.data;
  for (const key of Object.keys(node)) {
    const found = findImageData(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

const RUNNERS = {
  openai: { run: runOpenAI, env: 'OPENAI_API_KEY' },
  replicate: { run: runReplicate, env: 'REPLICATE_API_TOKEN' },
  gemini: { run: runGemini, env: 'GEMINI_API_KEY' }
};

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return bad(400, 'Send a JSON body.'); }
  if (!body.prompt) return bad(400, 'A prompt is required.');

  const runner = RUNNERS[body.provider];
  if (!runner) return bad(400, `Unknown provider "${body.provider}". Use gemini, openai or replicate.`);

  // The server's own key wins; a key in the request is the fallback for quick trials.
  const key = (env && env[runner.env]) || body.apiKey;
  if (!key) {
    return bad(401, `No key for ${body.provider}. Set ${runner.env} in the deployment's environment variables, or supply one from the app.`);
  }

  try {
    const { b64, mime } = await runner.run(body, key);
    return new Response(JSON.stringify({ b64, mime }), { headers: JSON_HEADERS });
  } catch (err) {
    // The provider's own words: this is the one place a wrong request shape becomes
    // diagnosable in a single run instead of a guessing game.
    return bad(502, String(err && err.message ? err.message : err));
  }
}

// A GET says which providers this deployment can serve, so the app can tell the user
// "OpenAI needs a key here" before they wait on a failed generation.
export async function onRequestGet({ env }) {
  const available = {};
  for (const [name, runner] of Object.entries(RUNNERS)) available[name] = Boolean(env && env[runner.env]);
  return new Response(JSON.stringify({ available }), { headers: JSON_HEADERS });
}
