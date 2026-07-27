import { readTeamMember } from "@/lib/session";
import { supabaseConfigured } from "@/lib/supabase/admin";
import { resendConfigured } from "@/lib/email";
import SignIn from "@/components/SignIn";
import Dashboard from "@/components/Dashboard";
import SetupNotice from "@/components/SetupNotice";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (!supabaseConfigured()) return <SetupNotice />;

  const member = await readTeamMember();
  if (!member) return <SignIn />;

  return <Dashboard member={member.name} emailReady={resendConfigured()} />;
}
