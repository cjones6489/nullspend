"use client";

import { useEffect } from "react";

/**
 * Sets `data-dashboard` on <body> so the dashboard theme CSS variables
 * (defined in globals.css) apply to both the dashboard and any portals
 * (dialogs, dropdowns, popovers) that render at <body> level.
 */
export function DashboardTheme() {
  useEffect(() => {
    document.body.setAttribute("data-dashboard", "");
    return () => {
      document.body.removeAttribute("data-dashboard");
    };
  }, []);

  return null;
}
