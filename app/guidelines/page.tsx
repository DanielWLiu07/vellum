import { redirect } from "next/navigation";

// The event-guidelines browser lives in the dashboard now, so the left sidebar
// stays put while you browse seasons. This route is kept so existing links and
// bookmarks still land there (307).
export default function GuidelinesPage() {
  redirect("/dashboard?section=guidelines");
}
