"use client";

import { CommandTrigger } from "./command-trigger";
import { MobileSidebar } from "./sidebar";
import { UserMenu } from "./user-menu";

export function DashboardHeader({ email }: { email: string | null }) {
  return (
    <header className="flex h-14 items-center border-b border-border/50 px-4 md:px-6">
      <MobileSidebar />
      <div className="ml-auto flex items-center gap-2">
        <CommandTrigger />
        <UserMenu email={email} />
      </div>
    </header>
  );
}
