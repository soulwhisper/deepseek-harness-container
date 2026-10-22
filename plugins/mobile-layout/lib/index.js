/**
 * Host half of the mobile layout plugin.
 *
 * The behaviour is entirely in the browser half (`lib/client.js`). This entry
 * exists because the client module loader discovers the browser half through
 * the package's `dsh.client` declaration, which requires a loadable host row.
 */

export const name = 'mobile-layout';

/** No host-side behaviour. */
export function apply() {}
