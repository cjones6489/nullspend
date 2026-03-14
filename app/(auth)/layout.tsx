import { Shield } from "lucide-react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-8 flex items-center gap-2">
        <Shield className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold tracking-tight text-foreground">
          NullSpend
        </span>
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
