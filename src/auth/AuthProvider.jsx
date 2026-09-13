import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { useNavigate } from 'react-router-dom';
import { auth0Config } from './config.js';
import { SessionProvider } from '../state/SessionContext.jsx';

// Wraps SessionProvider with Auth0 when configured. Must sit inside the Router
// so the post-login redirect can navigate to /callback with the chosen role.
export default function AuthProvider({ children }) {
  const navigate = useNavigate();
  if (!auth0Config) return <SessionProvider auth0={null}>{children}</SessionProvider>;

  return (
    <Auth0Provider
      domain={auth0Config.domain}
      clientId={auth0Config.clientId}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: auth0Config.audience,
        scope: 'openid profile email offline_access',
      }}
      // Refresh tokens + localStorage so sessions survive reloads and browsers
      // that block third-party cookies (silent iframe auth would fail there).
      useRefreshTokens
      cacheLocation="localstorage"
      onRedirectCallback={(appState) => navigate('/callback', { replace: true, state: { role: appState?.role ?? null } })}
    >
      <Auth0Bridge>{children}</Auth0Bridge>
    </Auth0Provider>
  );
}

function Auth0Bridge({ children }) {
  const auth0 = useAuth0();
  return <SessionProvider auth0={auth0}>{children}</SessionProvider>;
}
