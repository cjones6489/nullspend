import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { SupabaseEnvError } from "@/lib/auth/errors";
import { createServerSupabaseClient } from "@/lib/auth/supabase";

async function isAuthenticated(): Promise<boolean> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase.auth.getUser();
    return !!data.user;
  } catch (error) {
    if (error instanceof SupabaseEnvError) return false;
    return false;
  }
}

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAuthenticated();

  return (
    <div className="min-h-screen bg-background">
      <MarketingNav isAuthenticated={authed} />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}
