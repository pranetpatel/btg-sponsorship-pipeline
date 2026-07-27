import { readTeamMember } from "@/lib/session";
import { resendConfigured } from "@/lib/email";
import SignIn from "@/components/SignIn";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Page() {
  const member = await readTeamMember();
  if (!member) return <SignIn />;

  return <Dashboard member={member.name} emailReady={resendConfigured()} />;
}
