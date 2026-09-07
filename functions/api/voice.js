// functions/api/voice.js — the text-to-speech proxy.
//
// Same shape and the same three reasons as functions/api/image.js: keys stay server-side,
// neither provider allows browser calls, and the browser gets bytes rather than a URL.
//
// Environment variables: OPENAI_API_KEY, ELEVENLABS_API_KEY

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function bad(status, message) {
  return new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function readError(res, provider) {
  let detail = '';
  try { detail = (await res.text()).slice(0, 400); } catch { /* nothing readable */ }
  return `${provider} responded ${res.status}${detail ? ': ' + detail : ''}`;
}

// Both endpoints answer with raw audio, not JSON — so success is "read the body as bytes".
async function audioResponse(res, provider, fallbackMime) {
  if (!res.ok) throw new Error(await readError(res, provider));
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.length) throw new Error(`${provider} returned an empty audio body`);
  return { b64: bytesToBase64(bytes), mime: res.headers.get('content-type') || fallbackMime };
}

async function runOpenAI(body, key) {
  const request = {
    model: body.model || 'gpt-4o-mini-tts',
    input: body.text,
    voice: body.voice || 'onyx',
    response_format: 'mp3'
  };
  // `instructions` steers delivery on the current TTS models and is rejected by the older
  // tts-1 family, so only send it when there is something to say.
  if (body.instructions) request.instructions = body.instructions;
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, ...JSON_HEADERS },
    body: JSON.stringify(request)
  });
  return audioResponse(res, 'OpenAI', 'audio/mpeg');
}

async function runElevenLabs(body, key) {
  const voice = body.voice || 'JBFqnCBsd6RMkjVDRZzb';
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
    method: 'POST',
    headers: { 'xi-api-key': key, ...JSON_HEADERS },
    body: JSON.stringify({
      text: body.text,
      model_id: body.model || 'eleven_multilingual_v2',
      output_format: 'mp3_44100_128'
    })
  });
  return audioResponse(res, 'ElevenLabs', 'audio/mpeg');
}

const RUNNERS = {
  openai: { run: runOpenAI, env: 'OPENAI_API_KEY' },
  elevenlabs: { run: runElevenLabs, env: 'ELEVENLABS_API_KEY' }
};

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return bad(400, 'Send a JSON body.'); }
  if (!body.text || !String(body.text).trim()) return bad(400, 'Nothing to narrate.');
  if (String(body.text).length > 5000) return bad(400, 'That line is too long to narrate in one go.');

  const runner = RUNNERS[body.provider];
  if (!runner) return bad(400, `Unknown provider "${body.provider}". Use openai or elevenlabs.`);

  const key = (env && env[runner.env]) || body.apiKey;
  if (!key) {
    return bad(401, `No key for ${body.provider}. Set ${runner.env} in the deployment's environment variables, or supply one from the app.`);
  }

  try {
    const { b64, mime } = await runner.run(body, key);
    return new Response(JSON.stringify({ b64, mime }), { headers: JSON_HEADERS });
  } catch (err) {
    return bad(502, String(err && err.message ? err.message : err));
  }
}

export async function onRequestGet({ env }) {
  const available = {};
  for (const [name, runner] of Object.entries(RUNNERS)) available[name] = Boolean(env && env[runner.env]);
  return new Response(JSON.stringify({ available }), { headers: JSON_HEADERS });
}
