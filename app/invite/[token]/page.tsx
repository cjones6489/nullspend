import { getCurrentUserId } from "@/lib/auth/session";

import { InviteAcceptClient } from "./client";

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * /invite/[token] — public invitation acceptance page.
 * Server component checks auth state, client component handles the accept flow.
 */
export default async function InviteAcceptPage({ params }: PageProps) {
  const { token } = await params;
  let userId: string | null = null;

  try {
    userId = await getCurrentUserId();
  } catch {
    // Auth failed — user is not logged in
  }

  return <InviteAcceptClient token={token} isAuthenticated={!!userId} />;
}
