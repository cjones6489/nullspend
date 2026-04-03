"use client";

import { CommandTrigger } from "./command-trigger";
import { UserMenu } from "./user-menu";

export function DashboardHeader({ email }: { email: string | null }) {
  return (
    <header className="flex h-14 items-center justify-end border-b border-border/50 px-6">
      <div className="flex items-center gap-2">
        <CommandTrigger />
        <UserMenu email={email} />
      </div>
    </header>
  );
}
