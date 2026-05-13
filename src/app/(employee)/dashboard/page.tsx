import { requireEmployee } from "@/lib/auth";

// Phase 1: balance bars are MOCKED. Real values come from BalanceTransaction
// aggregation in Phase 3 once the time-off engine lands.
const MOCK_BALANCES = {
  vacation: { total: 80, used: 24, pending: 8, renewsOn: "March 15, 2027" },
  personal: { total: 63, used: 12, pending: 0, renewsOn: "March 15, 2027" },
};

export default async function DashboardPage() {
  await requireEmployee();
  const v = MOCK_BALANCES.vacation;
  const p = MOCK_BALANCES.personal;

  return (
    <div className="space-y-6">
      <BalanceCard
        title="Vacation"
        total={v.total}
        used={v.used}
        pending={v.pending}
        renewsOn={v.renewsOn}
      />
      <BalanceCard
        title="Personal / Sick"
        total={p.total}
        used={p.used}
        pending={p.pending}
        renewsOn={p.renewsOn}
      />

      <section>
        <h2 className="mb-2 text-sm font-semibold">Upcoming time off</h2>
        <p className="text-sm text-muted-foreground">None.</p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Pending requests</h2>
        <p className="text-sm text-muted-foreground">None.</p>
      </section>

      <div className="space-y-2">
        <button
          type="button"
          className="w-full rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
          disabled
        >
          Request time off (Phase 3)
        </button>
        <button
          type="button"
          className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm font-medium"
          disabled
        >
          View my schedule (Phase 2)
        </button>
      </div>
    </div>
  );
}

function BalanceCard({
  title,
  total,
  used,
  pending,
  renewsOn,
}: {
  title: string;
  total: number;
  used: number;
  pending: number;
  renewsOn: string;
}) {
  const available = Math.max(0, total - used - pending);
  const pct = (n: number) => (total === 0 ? 0 : (n / total) * 100);
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{total}h total</p>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="absolute left-0 top-0 h-full bg-foreground"
          style={{ width: `${pct(used)}%` }}
        />
        <div
          className="absolute top-0 h-full bg-foreground/40"
          style={{ left: `${pct(used)}%`, width: `${pct(pending)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Used: {used}h · Pending: {pending}h · Available: {available}h
      </p>
      <p className="mt-1 text-xs text-muted-foreground">Renews {renewsOn}</p>
    </section>
  );
}
