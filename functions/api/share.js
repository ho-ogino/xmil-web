// POST /api/share — Save BASIC code to D1, return short ID

export async function onRequestPost({ request, env }) {
    let body;
    try {
        body = await request.json();
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
    }

    const { basic } = body;
    if (!basic || typeof basic !== 'string') {
        return new Response(JSON.stringify({ error: 'No code' }), { status: 400 });
    }
    if (basic.length > 64 * 1024) {
        return new Response(JSON.stringify({ error: 'Too large' }), { status: 413 });
    }

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let id;
    for (let attempt = 0; attempt < 3; attempt++) {
        id = Array.from(crypto.getRandomValues(new Uint8Array(8)))
            .map(b => chars[b % 62]).join('');
        try {
            await env.X1PEN_DB
                .prepare('INSERT INTO shares (id, basic, created_at) VALUES (?, ?, ?)')
                .bind(id, basic, Date.now())
                .run();
            break;
        } catch (e) {
            if (attempt === 2) {
                return new Response(JSON.stringify({ error: 'ID generation failed' }), { status: 503 });
            }
        }
    }

    return new Response(JSON.stringify({ id }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
