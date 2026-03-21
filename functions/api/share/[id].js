// GET /api/share/:id — Retrieve gzip-compressed share data from D1

export async function onRequestGet({ params, env }) {
    if (!/^[A-Za-z0-9]{8}$/.test(params.id)) {
        return new Response(JSON.stringify({ error: 'Invalid ID' }), { status: 400 });
    }

    if (!env.X1PEN_DB) {
        return new Response(JSON.stringify({ error: 'DB not configured' }), { status: 500 });
    }

    const row = await env.X1PEN_DB
        .prepare('SELECT data, codec FROM shares WHERE id = ?')
        .bind(params.id)
        .first();

    if (!row) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }

    // D1 returns BLOB as Array — convert to Uint8Array
    return new Response(new Uint8Array(row.data), {
        headers: {
            'Content-Type': 'application/octet-stream',
            'X-X1pen-Codec': row.codec || 'gzip'
        }
    });
}
