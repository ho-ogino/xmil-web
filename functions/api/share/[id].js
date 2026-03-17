// GET /api/share/:id — Retrieve shared BASIC code from D1

export async function onRequestGet({ params, env }) {
    if (!/^[A-Za-z0-9]{8}$/.test(params.id)) {
        return new Response(JSON.stringify({ error: 'Invalid ID' }), { status: 400 });
    }

    const row = await env.X1PEN_DB
        .prepare('SELECT basic, created_at FROM shares WHERE id = ?')
        .bind(params.id)
        .first();

    if (!row) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    }

    return new Response(JSON.stringify({ basic: row.basic, createdAt: row.created_at }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
