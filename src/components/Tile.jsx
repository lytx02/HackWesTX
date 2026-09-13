// Dashboard tile. `span` maps to a 12-column grid (8, 6, 4, or 12).
export default function Tile({ title, action, span = 12, children, className = '' }) {
  return (
    <section className={`card tile span-${span} ${className}`}>
      <div className="tile-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
