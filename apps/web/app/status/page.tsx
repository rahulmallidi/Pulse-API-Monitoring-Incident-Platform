export default function PublicStatusPage(): JSX.Element {
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-8">
      <section className="rounded-2xl border border-pulse-line bg-pulse-panel p-6 shadow-[0_24px_55px_-42px_rgba(13,39,53,0.85)]">
        <p className="text-xs uppercase tracking-[0.16em] text-pulse-muted">Public Reliability Bulletin</p>
        <h1 className="mt-2 text-3xl font-semibold text-pulse-text">Pulse Service Status</h1>
        <p className="mt-2 max-w-3xl text-sm text-pulse-muted">
          This page is designed for business teams and customers. It explains current reliability in plain language,
          without requiring technical context.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-emerald-700">Current State</p>
            <p className="mt-2 text-lg font-semibold text-emerald-800">All core services operational</p>
          </article>
          <article className="rounded-xl border border-pulse-line bg-white p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-pulse-muted">30-day uptime</p>
            <p className="mono mt-2 text-2xl font-semibold text-pulse-text">99.95%</p>
          </article>
          <article className="rounded-xl border border-pulse-line bg-white p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-pulse-muted">Median response time</p>
            <p className="mono mt-2 text-2xl font-semibold text-pulse-text">188ms</p>
          </article>
        </div>

        <div className="mt-6 rounded-xl border border-pulse-line bg-pulse-tag p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-pulse-muted">Customer Summary</p>
          <p className="mt-2 text-sm text-pulse-text">
            No widespread customer disruption is currently detected. We are monitoring elevated latency in one region,
            with no active checkout outage at this time.
          </p>
        </div>
      </section>
    </main>
  );
}
