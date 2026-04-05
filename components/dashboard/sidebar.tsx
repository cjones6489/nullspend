"use client";

import { Activity, BarChart3, BookOpen, Clock, CreditCard, DollarSign, ExternalLink, Home, Inbox, Key, MessageSquare, PieChart, Settings, Shield, TrendingUp, Wrench } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { OrgSwitcher } from "@/components/dashboard/org-switcher";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const navSections: { label: string; items: NavItem[] }[] = [
  {
    label: "FinOps",
    items: [
      { href: "/app/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/app/activity", label: "Activity", icon: Activity },
      { href: "/app/sessions", label: "Sessions", icon: MessageSquare },
      { href: "/app/keys", label: "Keys", icon: Key },
      { href: "/app/budgets", label: "Budgets", icon: DollarSign },
      { href: "/app/tool-costs", label: "Tool Costs", icon: Wrench },
      { href: "/app/attribution", label: "Attribution", icon: PieChart },
      { href: "/app/margins", label: "Margins", icon: TrendingUp },
    ],
  },
  {
    label: "Approvals",
    items: [
      { href: "/app/inbox", label: "Inbox", icon: Inbox },
      { href: "/app/history", label: "History", icon: Clock },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/app/billing", label: "Billing", icon: CreditCard },
    ],
  },
];

const settingsItem: NavItem = { href: "/app/settings", label: "Settings", icon: Settings };

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 flex-col border-r border-border/50 bg-sidebar">
      <div className="flex h-14 items-center gap-2 border-b border-border/50 px-5">
        <Shield className="h-4 w-4 text-primary" />
        <Link
          href="/app/home"
          className="font-mono text-sm font-semibold tracking-tight text-foreground"
        >
          NullSpend
        </Link>
      </div>
      <div className="border-b border-border/50 py-1.5">
        <OrgSwitcher />
      </div>
      <nav className="flex flex-1 flex-col p-2">
        <Link
          href="/app/home"
          aria-current={pathname === "/app/home" ? "page" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-md px-3 py-1.5 font-mono text-[13px] font-medium transition-colors",
            pathname === "/app/home"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          <Home className="h-3.5 w-3.5" />
          Home
        </Link>
        {navSections.map((section) => (
          <div key={section.label}>
            <p className="px-3 pt-4 pb-1 font-mono text-[11px] font-medium uppercase tracking-widest text-muted-foreground/70">
              {section.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-1.5 font-mono text-[13px] font-medium transition-colors",
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
          </div>
        ))}
        <div className="mt-auto flex flex-col gap-0.5">
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <BookOpen className="h-3.5 w-3.5" />
            Documentation
            <ExternalLink className="ml-auto h-2.5 w-2.5 opacity-50" />
          </a>
          <Link
            href={settingsItem.href}
            aria-current={pathname === settingsItem.href || pathname.startsWith(settingsItem.href + "/") ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-1.5 font-mono text-[13px] font-medium transition-colors",
              pathname === settingsItem.href || pathname.startsWith(settingsItem.href + "/")
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <settingsItem.icon className="h-3.5 w-3.5" />
            {settingsItem.label}
          </Link>
        </div>
      </nav>
      <div className="border-t border-border/50 p-3">
        <a
          href="/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] text-muted-foreground/80 hover:text-muted-foreground transition-colors"
        >
          v0.1.0
        </a>
      </div>
    </aside>
  );
}
