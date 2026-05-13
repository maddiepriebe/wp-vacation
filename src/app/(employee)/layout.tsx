import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { requireEmployee } from "@/lib/auth";

const tabs = [
  { href: "/dashboard", label: "Home" },
  { href: "/schedule", label: "Schedule" },
  { href: "/notifications", label: "Inbox" },
] as const;

export default async function EmployeeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await requireEmployee();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">Hello,</p>
          <p className="text-sm font-semibold">{me.firstName}</p>
        </div>
        <UserButton afterSignOutUrl="/sign-in" />
      </header>
      <main className="flex-1 px-4 py-4 pb-24">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-3 border-t bg-background">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="py-3 text-center text-sm font-medium text-foreground/80 hover:bg-accent"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
