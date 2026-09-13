// Auth0 is enabled when VITE_AUTH0_DOMAIN and VITE_AUTH0_CLIENT_ID are set.
// These are public values (a SPA client id is not a secret). Without them the
// app falls back to the legacy email + role login, which is what the seeded
// demo accounts use.

const domain = import.meta.env.VITE_AUTH0_DOMAIN;
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const audience = import.meta.env.VITE_AUTH0_AUDIENCE;

export const auth0Config = domain && clientId ? { domain, clientId, audience } : null;
export const authMode = auth0Config ? 'auth0' : 'legacy';
