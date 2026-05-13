import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function RootPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (user.kind === "admin") redirect("/admin");
  redirect("/dashboard");
}
