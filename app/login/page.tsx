import { signIn } from "@/auth";

export default function Login() {
  return (
    <main className="m-auto w-full max-w-xs p-4">
      <h1 className="mb-1 text-lg font-semibold">GFS Contract Agent</h1>
      <p className="mb-4 text-muted">Owner access only.</p>
      <form
        action={async () => {
          "use server";
          await signIn("microsoft-entra-id", { redirectTo: "/" });
        }}
      >
        <button className="w-full rounded bg-accent px-3 py-2 font-medium text-white">Sign in with Microsoft</button>
      </form>
    </main>
  );
}
