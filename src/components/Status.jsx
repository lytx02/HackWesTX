// Loading / error placeholders for pages backed by the API.
export function Loading({ label = 'Loading...' }) {
  return <p className="muted fade-in">{label}</p>;
}

export function ErrorNote({ error, retry }) {
  return (
    <div className="card stack">
      <p className="error">{error?.message ?? 'Something went wrong.'}</p>
      {retry && (
        <button type="button" className="btn btn-sm" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
