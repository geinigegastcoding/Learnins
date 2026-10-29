import { Dashboard } from "@/components/dashboard";
import { readSettingsRecord } from "@/src/server";
import { slotsConfigured } from "@/src/core";

// Dynamic: the configured state is server-rendered into the page (the
// setup CTA's truth on the first frame), and every navigation re-reads
// the record (dynamic routes aren't cached client-side).
export const dynamic = "force-dynamic";

export default function HomePage() {
	const record = readSettingsRecord();
	return <Dashboard initialConfigured={slotsConfigured(record?.models)} initialTutorialCompleted={record?.tutorialCompleted === true} />;
}
