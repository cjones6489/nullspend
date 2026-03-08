import { redirect } from "next/navigation";

import { Sidebar } from "@/components/dashboard/sidebar";
import { UserMenu } from "@/components/dashboard/user-menu";
import { Toaster } from "@/components/ui/sonner";
import { SupabaseEnvError } from "@/lib/auth/errors";
import { createServerSupabaseClient } from "@/lib/auth/supabase";

function canUseDevelopmentFallback(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    !!process.env.AGENTSEAM_DEV_ACTOR
  );
}

async function getSessionEmail(): Promise<string | null> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase.auth.getClaims();
    return (data?.claims?.email as string) ?? null;
  } catch (error) {
    if (error instanceof SupabaseEnvError && canUseDevelopmentFallback()) {
      return null;
    }
    throw error;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let email: string | null = null;

  try {
    email = await getSessionEmail();
  } catch {
    redirect("/login");
  }

  if (!email && !canUseDevelopmentFallback()) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b border-border/50 px-6">
          <div />
          <UserMenu email={email ?? process.env.AGENTSEAM_DEV_ACTOR ?? null} />
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
      <Toaster theme="dark" />
    </div>
  );
}
