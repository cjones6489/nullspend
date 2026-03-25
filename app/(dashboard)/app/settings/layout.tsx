"use client";

import { Key, Puzzle, Users, Webhook } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const settingsNav = [
  { href: "/app/settings/api-keys", label: "API Keys", icon: Key },
  { href: "/app/settings/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/app/settings/integrations", label: "Integrations", icon: Puzzle },
  { href: "/app/settings/members", label: "Members", icon: Users },
] as const;

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Manage your API keys, webhooks, and integrations.
        </p>
      </div>

      <div className="flex gap-8">
        <nav className="w-44 shrink-0">
          <div className="flex flex-col gap-0.5">
            {settingsNav.map((item) => {
              const isActive =
                pathname === item.href ||
                pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
