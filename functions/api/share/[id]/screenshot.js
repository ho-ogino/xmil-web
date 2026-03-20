// GET /api/share/:id/screenshot — Serve screenshot PNG from R2

export async function onRequestGet({ params, env }) {
    if (!/^[A-Za-z0-9]{8}$/.test(params.id)) {
        return new Response('Invalid ID', { status: 400 });
    }

    if (!env.X1PEN_DB || !env.X1PEN_R2) {
        return new Response('Not configured', { status: 500 });
    }

    var row = await env.X1PEN_DB
        .prepare('SELECT screenshot_key FROM shares WHERE id = ?')
        .bind(params.id)
        .first();

    if (!row || !row.screenshot_key) {
        return new Response('Not found', { status: 404 });
    }

    var obj = await env.X1PEN_R2.get(row.screenshot_key);
    if (!obj) {
        return new Response('Not found', { status: 404 });
    }

    return new Response(obj.body, {
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=31536000, immutable'
        }
    });
}
