// POST /api/share — Save gzip-compressed share data to D1, screenshot to R2

export async function onRequestPost({ request, env }) {
    if (!env.X1PEN_DB) {
        return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 500 });
    }

    // Parse multipart or octet-stream
    var compressed;
    var screenshotBlob = null;
    var contentType = request.headers.get('Content-Type') || '';

    if (contentType.includes('multipart/form-data')) {
        var formData = await request.formData();
        var dataBlob = formData.get('data');
        if (!dataBlob || typeof dataBlob === 'string' || typeof dataBlob.arrayBuffer !== 'function') {
            return new Response(JSON.stringify({ error: 'Missing or invalid data part' }), { status: 400 });
        }
        compressed = await dataBlob.arrayBuffer();
        screenshotBlob = formData.get('screenshot');
    } else {
        // Legacy: application/octet-stream
        compressed = await request.arrayBuffer();
    }

    if (!compressed || compressed.byteLength === 0) {
        return new Response(JSON.stringify({ error: 'Empty body' }), { status: 400 });
    }
    if (compressed.byteLength > 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'Too large (compressed)' }), { status: 413 });
    }

    // Decompress and validate
    let parsed;
    let rawSize = 0;
    try {
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(new Uint8Array(compressed));
        writer.close();
        const decompressed = await new Response(ds.readable).arrayBuffer();
        rawSize = decompressed.byteLength;
        if (rawSize > 512 * 1024) {
            return new Response(JSON.stringify({ error: 'Too large (decompressed)' }), { status: 413 });
        }
        parsed = JSON.parse(new TextDecoder().decode(decompressed));
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid gzip or JSON' }), { status: 400 });
    }

    var hasBasic = parsed.basic && typeof parsed.basic === 'string';
    var hasAsm = parsed.asm && typeof parsed.asm === 'string';
    var hasSlang = parsed.slang && typeof parsed.slang === 'string';
    if (!hasBasic && !hasAsm && !hasSlang) {
        return new Response(JSON.stringify({ error: 'No code' }), { status: 400 });
    }

    // Generate 8-char ID with collision retry
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id;
    for (let attempt = 0; attempt < 3; attempt++) {
        id = Array.from(crypto.getRandomValues(new Uint8Array(8)))
            .map(b => chars[b % 62]).join('');

        // Save screenshot to R2 first (only if successful do we record the key)
        let screenshotKey = null;
        if (screenshotBlob && screenshotBlob.type === 'image/png' && env.X1PEN_R2) {
            const pngData = await screenshotBlob.arrayBuffer();
            if (pngData.byteLength > 0 && pngData.byteLength <= 512 * 1024) {
                const key = 'screenshots/' + id + '.png';
                try {
                    await env.X1PEN_R2.put(key, pngData, {
                        httpMetadata: { contentType: 'image/png' }
                    });
                    screenshotKey = key;
                } catch (e) {
                    console.error('R2 put failed:', e);
                }
            }
        }

        // Save to D1
        try {
            await env.X1PEN_DB
                .prepare('INSERT INTO shares (id, data, codec, raw_size, screenshot_key, created_at) VALUES (?, ?, ?, ?, ?, ?)')
                .bind(id, compressed, 'gzip', rawSize, screenshotKey, Date.now())
                .run();
            break;
        } catch (e) {
            // D1 failed → clean up R2 orphan
            if (screenshotKey && env.X1PEN_R2) {
                try { await env.X1PEN_R2.delete(screenshotKey); } catch (_) {}
            }
            const msg = (e.message || '').toLowerCase();
            if (msg.includes('unique') || msg.includes('constraint')) {
                if (attempt === 2) {
                    return new Response(JSON.stringify({ error: 'ID generation failed' }), { status: 503 });
                }
                continue;
            }
            return new Response(JSON.stringify({ error: 'DB error: ' + e.message }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ id }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
