import { SignUp } from "@clerk/nextjs";

// Self-serve sign-up is disabled in the Clerk dashboard.
// Employees arrive here via invite links; admins are seeded.
export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <SignUp />
    </main>
  );
}
