import { redirect } from "next/navigation";

/**
 * The old Vellum microservice landing lived here (pitch for the embeddable
 * zero-knowledge viewer). The viewer itself — /embed + the signed-token
 * handshake — is still load-bearing (the member platform's /learn secure
 * viewer integrates against it; see README), but this app's front door is
 * the HOSA Vitals dashboard now.
 */
export default function Home() {
  redirect("/dashboard");
}
