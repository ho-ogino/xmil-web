// /x1pen — Intercept to inject OG meta tags for shared programs

export async function onRequest({ request, env, next }) {
    var url = new URL(request.url);
    var id = url.searchParams.get('id');

    // No ?id= → serve static HTML as-is
    if (!id || !/^[A-Za-z0-9]{8}$/.test(id)) {
        return next();
    }

    // Get the static HTML first
    var response = await next();
    if (!response.ok) return response;

    var html = await response.text();

    // Look up screenshot info from D1
    var ogTags = '';
    try {
        if (env.X1PEN_DB) {
            var row = await env.X1PEN_DB
                .prepare('SELECT screenshot_key FROM shares WHERE id = ?')
                .bind(id)
                .first();

            ogTags += '<meta property="og:title" content="X1Pen \u2014 Shared Program">';
            ogTags += '<meta property="og:url" content="' + url.origin + '/x1pen?id=' + id + '">';

            if (row && row.screenshot_key) {
                ogTags += '<meta property="og:image" content="' + url.origin + '/api/share/' + id + '/screenshot">';
                ogTags += '<meta name="twitter:card" content="summary_large_image">';
            } else {
                ogTags += '<meta name="twitter:card" content="summary">';
            }
        }
    } catch (e) {
        console.error('OG meta injection failed:', e);
    }

    if (ogTags) {
        html = html.replace('</head>', ogTags + '</head>');
    }

    // Preserve original response status/headers, override Content-Type
    var newHeaders = new Headers(response.headers);
    newHeaders.set('Content-Type', 'text/html; charset=utf-8');
    return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders
    });
}
