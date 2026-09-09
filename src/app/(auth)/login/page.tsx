import { redirect } from "next/navigation";
import { getOrgContext } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getOrgContext()) redirect("/");

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1">
          <h1 className="text-xl font-black tracking-tight">Backdrop</h1>
          <p className="text-sm text-muted-foreground">
            Access by invitation only.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
