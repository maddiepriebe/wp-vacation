import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db/client";
import {
  auditLog,
  balanceTransactions,
  classes,
  employees,
} from "@/db/schema";
import { InviteButtons } from "../_components/InviteButtons";
import { HistoricalUsageDialog } from "../_components/HistoricalUsageDialog";
import {
  recordHistoricalUsageAction,
  resendInviteAction,
  sendInviteAction,
} from "../actions";

export default async function EmployeeProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const [row] = await db
    .select({
      emp: employees,
      className: classes.name,
    })
    .from(employees)
    .leftJoin(classes, eq(classes.id, employees.defaultClassId))
    .where(eq(employees.id, id));
  if (!row) notFound();

  const recentTx = await db
    .select()
    .from(balanceTransactions)
    .where(eq(balanceTransactions.employeeId, id))
    .orderBy(desc(balanceTransactions.createdAt))
    .limit(20);

  const [lastInvite] = await db
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.entityType, "employee"),
        eq(auditLog.entityId, id),
        inArray(auditLog.action, [
          "employee.invite_sent",
          "employee.invite_resent",
        ]),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(1);

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {row.emp.firstName} {row.emp.lastName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {row.emp.email} · {row.className ?? "no class"} ·{" "}
          {row.emp.roleInClass}
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Clerk invitation</h2>
        <InviteButtons
          employeeId={row.emp.id}
          alreadyLinked={Boolean(row.emp.clerkUserId)}
          hasPriorInvite={Boolean(lastInvite)}
          sendAction={sendInviteAction}
          resendAction={resendInviteAction}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Balances</h2>
        <p className="text-sm">
          Vacation: {row.emp.vacationHoursBalance} hours · Personal:{" "}
          {row.emp.personalHoursBalance} hours
        </p>
        <HistoricalUsageDialog
          employeeId={row.emp.id}
          action={recordHistoricalUsageAction}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Recent balance transactions</h2>
        {recentTx.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {recentTx.map((t) => (
              <li key={t.id}>
                {t.balanceKind}: {Number(t.deltaHours) > 0 ? "+" : ""}
                {t.deltaHours}h ({t.source})
                {t.note && ` — ${t.note}`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
