"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, CheckCircle, XCircle, Clock, LogIn } from "lucide-react";

import { apiPost } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type AcceptResult = {
  orgId: string;
  role: string;
  redirectUrl: string;
};

type AcceptError = {
  error: {
    code: string;
    message: string;
  };
};

type PageState =
  | { kind: "ready" }
  | { kind: "accepting" }
  | { kind: "success"; orgId: string; role: string; redirectUrl: string }
  | { kind: "error"; code: string; message: string };

export function InviteAcceptClient({
  token,
  isAuthenticated,
}: {
  token: string;
  isAuthenticated: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<PageState>({ kind: "ready" });

  async function handleAccept() {
    setState({ kind: "accepting" });

    try {
      const result = await apiPost<AcceptResult>("/api/invite/accept", { token });
      setState({
        kind: "success",
        orgId: result.orgId,
        role: result.role,
        redirectUrl: result.redirectUrl,
      });
      // Auto-redirect after brief success state
      setTimeout(() => router.push(result.redirectUrl), 1500);
    } catch (err) {
      if (err && typeof err === "object" && "body" in err) {
        const body = (err as { body: AcceptError }).body;
        if (body?.error) {
          setState({ kind: "error", code: body.error.code, message: body.error.message });
          return;
        }
      }
      setState({
        kind: "error",
        code: "unknown",
        message: err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  }

  const loginUrl = `/login?next=${encodeURIComponent(`/invite/${token}`)}`;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-8 flex items-center gap-2">
        <Shield className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold tracking-tight text-foreground">
          NullSpend
        </span>
      </div>

      <Card className="w-full max-w-sm">
        {/* Not logged in */}
        {!isAuthenticated && (
          <>
            <CardHeader>
              <CardTitle className="text-base">Sign in to accept invitation</CardTitle>
              <CardDescription>
                You need to sign in or create an account to join this organization.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button className="w-full" onClick={() => router.push(loginUrl)}>
                <LogIn className="mr-2 h-4 w-4" />
                Sign in
              </Button>
            </CardFooter>
          </>
        )}

        {/* Ready to accept */}
        {isAuthenticated && state.kind === "ready" && (
          <>
            <CardHeader>
              <CardTitle className="text-base">Accept invitation</CardTitle>
              <CardDescription>
                You've been invited to join an organization on NullSpend.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button className="w-full" onClick={handleAccept}>
                Accept Invitation
              </Button>
            </CardFooter>
          </>
        )}

        {/* Accepting... */}
        {state.kind === "accepting" && (
          <CardContent className="py-8 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Joining organization...</p>
          </CardContent>
        )}

        {/* Success */}
        {state.kind === "success" && (
          <>
            <CardContent className="py-8 text-center">
              <CheckCircle className="mx-auto mb-3 h-8 w-8 text-green-500" />
              <p className="text-sm font-medium text-foreground">
                You joined as {state.role}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Redirecting to dashboard...
              </p>
            </CardContent>
          </>
        )}

        {/* Error */}
        {state.kind === "error" && (
          <>
            <CardContent className="py-8 text-center">
              {state.code === "expired" ? (
                <Clock className="mx-auto mb-3 h-8 w-8 text-amber-500" />
              ) : (
                <XCircle className="mx-auto mb-3 h-8 w-8 text-red-500" />
              )}
              <p className="text-sm font-medium text-foreground">
                {state.code === "expired"
                  ? "Invitation expired"
                  : state.code === "conflict"
                    ? "Cannot accept invitation"
                    : "Invalid invitation"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{state.message}</p>
            </CardContent>
            <CardFooter className="justify-center">
              <Button variant="outline" size="sm" onClick={() => router.push("/app")}>
                Go to dashboard
              </Button>
            </CardFooter>
          </>
        )}
      </Card>
    </div>
  );
}
