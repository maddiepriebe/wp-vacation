import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  if (user.kind === "orphaned") {
    return NextResponse.json(
      { kind: "orphaned", clerkUserId: user.clerkUserId },
      { status: 403 },
    );
  }
  if (user.kind === "admin") {
    return NextResponse.json({
      kind: "admin",
      id: user.admin.id,
      firstName: user.admin.firstName,
      lastName: user.admin.lastName,
      email: user.admin.email,
      adminRole: user.admin.adminRole,
    });
  }
  return NextResponse.json({
    kind: "employee",
    id: user.employee.id,
    firstName: user.employee.firstName,
    lastName: user.employee.lastName,
    email: user.employee.email,
    defaultClassId: user.employee.defaultClassId,
    roleInClass: user.employee.roleInClass,
  });
}
