"use client";

import { GeneralSection } from "@/components/settings/general-section";
import { UpgradeUrlSection } from "@/components/settings/upgrade-url-section";

export default function GeneralPage() {
  return (
    <div className="space-y-4">
      <GeneralSection />
      <UpgradeUrlSection />
    </div>
  );
}
