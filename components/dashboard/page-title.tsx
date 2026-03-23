"use client";

import { usePathname } from "next/navigation";

const ROUTE_TITLES: Record<string, string> = {
  "/app/inbox": "Inbox",
  "/app/history": "History",
  "/app/budgets": "Budgets",
  "/app/activity": "Activity",
  "/app/analytics": "Analytics",
  "/app/billing": "Billing",
  "/app/settings": "Settings",
};

export function PageTitle() {
  const pathname = usePathname();

  let title = ROUTE_TITLES[pathname];

  if (!title && pathname.startsWith("/app/actions/")) {
    title = "Action Details";
  }

  if (!title) {
    title = "NullSpend";
  }

  return (
    <h1 className="font-mono text-sm font-medium text-foreground">{title}</h1>
  );
}
