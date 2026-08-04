import type { ReactNode } from "react";

type MetricCardProps = {
  label: string;
  value: string;
  children?: ReactNode;
};

export function MetricCard({ label, value, children }: MetricCardProps): JSX.Element {
  return (
    <article style={{ border: "1px solid #d6dde8", borderRadius: 4, padding: 12, background: "#fff" }}>
      <p style={{ margin: 0, color: "#64748b", fontSize: 12, textTransform: "uppercase" }}>{label}</p>
      <p style={{ margin: "8px 0", fontSize: 24, fontWeight: 600 }}>{value}</p>
      {children}
    </article>
  );
}
