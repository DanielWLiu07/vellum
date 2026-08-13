/**
 * Where the request gate sends someone without a session.
 *
 * It cannot send them to "/": that route redirects straight to /dashboard,
 * which the gate blocks, which returns here — an infinite bounce. This page is
 * public and terminal, which is the whole requirement.
 *
 * Vitals has no sign-in of its own by design (lib/identity-token): members
 * arrive from the HOSA member platform carrying a signed token. So the honest
 * thing to show is where to go, not a login form that cannot exist.
 */

export const dynamic = "force-dynamic";

export default async function SignedOut({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  // Only ever echoed as text, and only when it looks like one of our own
  // paths — it arrives from the URL, so it is not to be trusted as a link.
  const target = typeof from === "string" && /^\/[A-Za-z0-9/_-]{0,64}$/.test(from) ? from : null;

  return (
    <main className="upload-card" style={{ maxWidth: 560, margin: "12vh auto" }}>
      <h1 className="upload-h">Open Vitals from the HOSA member platform</h1>
      <p className="dash-sub">
        Vitals doesn&apos;t have its own accounts. Sign in on the member platform and open Study
        resources — that hands your membership across and signs you in here automatically.
      </p>
      {target ? (
        <p className="dash-sub">
          You&apos;ll land back on <code>{target}</code> once you&apos;re signed in.
        </p>
      ) : null}
      <p className="dash-sub">
        Already signed in on another tab? Your session may have expired — open Study resources
        again to refresh it.
      </p>
    </main>
  );
}
