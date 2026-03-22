"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Activity, BarChart3, BookOpen, CreditCard, Home, Inbox, Clock, DollarSign, Settings } from "lucide-react";

import {
  CommandDialog,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { useActions } from "@/lib/queries/actions";
import { formatActionType } from "@/lib/utils/format";
import { useCommandPalette } from "./command-palette-context";

const NAV_ITEMS = [
  { label: "Home", href: "/app/home", icon: Home, shortcut: "G G" },
  { label: "Inbox", href: "/app/inbox", icon: Inbox, shortcut: "G I" },
  { label: "History", href: "/app/history", icon: Clock, shortcut: "G H" },
  { label: "Budgets", href: "/app/budgets", icon: DollarSign, shortcut: "G B" },
  { label: "Analytics", href: "/app/analytics", icon: BarChart3, shortcut: "G N" },
  { label: "Activity", href: "/app/activity", icon: Activity, shortcut: "G A" },
  { label: "Billing", href: "/app/billing", icon: CreditCard, shortcut: "G L" },
  { label: "Settings", href: "/app/settings", icon: Settings, shortcut: "G S" },
  { label: "Documentation", href: "/docs", icon: BookOpen, shortcut: "G D" },
];

export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const router = useRouter();
  const { data: actionsData } = useActions(undefined, 20);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [setOpen]);

  function navigate(href: string) {
    setOpen(false);
    router.push(href);
  }

  const actions = actionsData?.data ?? [];

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Command>
        <CommandInput placeholder="Search commands, actions..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigation">
            {NAV_ITEMS.map((item) => (
              <CommandItem
                key={item.href}
                onSelect={() => navigate(item.href)}
              >
                <item.icon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                {item.label}
                <CommandShortcut>{item.shortcut}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          {actions.length > 0 && (
            <CommandGroup heading="Recent Actions">
              {actions.map((action) => (
                <CommandItem
                  key={action.id}
                  onSelect={() => navigate(`/app/actions/${action.id}`)}
                >
                  <span className="mr-2 text-[13px]">
                    {formatActionType(action.actionType)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {action.agentId}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
