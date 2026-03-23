import { redirect } from "next/navigation";

import { CommandPalette } from "@/components/dashboard/command-palette";
import { CommandPaletteProvider } from "@/components/dashboard/command-palette-context";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardTheme } from "@/components/dashboard/dashboard-theme";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { SupabaseEnvError } from "@/lib/auth/errors";
import { createServerSupabaseClient } from "@/lib/auth/supabase";

function canUseDevelopmentFallback(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    !!process.env.NULLSPEND_DEV_ACTOR
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
    <CommandPaletteProvider>
      <DashboardTheme />
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <DashboardHeader email={email ?? process.env.NULLSPEND_DEV_ACTOR ?? null} />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
      <CommandPalette />
      <Toaster theme="dark" />
    </CommandPaletteProvider>
  );
}
