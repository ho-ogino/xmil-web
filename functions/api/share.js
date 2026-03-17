// POST /api/share — Save gzip-compressed share data to D1

export async function onRequestPost({ request, env }) {
    if (!env.X1PEN_DB) {
        return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 500 });
    }

    // Read compressed body
    const compressed = await request.arrayBuffer();
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

    if (!parsed.basic || typeof parsed.basic !== 'string') {
        return new Response(JSON.stringify({ error: 'No basic code' }), { status: 400 });
    }

    // Generate 8-char ID with collision retry
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id;
    for (let attempt = 0; attempt < 3; attempt++) {
        id = Array.from(crypto.getRandomValues(new Uint8Array(8)))
            .map(b => chars[b % 62]).join('');
        try {
            await env.X1PEN_DB
                .prepare('INSERT INTO shares (id, data, codec, raw_size, created_at) VALUES (?, ?, ?, ?, ?)')
                .bind(id, compressed, 'gzip', rawSize, Date.now())
                .run();
            break;
        } catch (e) {
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
