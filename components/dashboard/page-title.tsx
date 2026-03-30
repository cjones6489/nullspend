"use client";

import { usePathname } from "next/navigation";

const ROUTE_TITLES: Record<string, string> = {
  "/app/home": "Home",
  "/app/inbox": "Inbox",
  "/app/history": "History",
  "/app/budgets": "Budgets",
  "/app/tool-costs": "Tool Costs",
  "/app/activity": "Activity",
  "/app/sessions": "Sessions",
  "/app/keys": "Keys",
  "/app/analytics": "Analytics",
  "/app/attribution": "Attribution",
  "/app/billing": "Billing",
  "/app/settings": "Settings",
};

export function PageTitle() {
  const pathname = usePathname();

  let title = ROUTE_TITLES[pathname];

  if (!title && pathname.startsWith("/app/settings/")) {
    title = "Settings";
  }

  if (!title && pathname.startsWith("/app/actions/")) {
    title = "Action Details";
  }
  if (!title && pathname.startsWith("/app/sessions/")) {
    title = "Session Details";
  }
  if (!title && pathname.startsWith("/app/cost-events/")) {
    title = "Cost Event";
  }
  if (!title && pathname.startsWith("/app/attribution/")) {
    title = "Attribution";
  }
  if (!title && pathname.startsWith("/app/keys")) {
    title = "Keys";
  }

  if (!title) {
    title = "NullSpend";
  }

  return (
    <h1 className="font-mono text-sm font-medium text-foreground">{title}</h1>
  );
}
