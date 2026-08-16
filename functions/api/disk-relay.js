import { handleRelayRequest } from '../_lib/disk-relay.js';

export function onRequest(context) {
    return handleRelayRequest({
        request: context.request,
        env: context.env,
        fetchImpl: fetch,
    });
}
