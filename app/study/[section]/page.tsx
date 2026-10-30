import { notFound } from "next/navigation";
import { StudyWorkspace, type StudySection } from "@/components/study-workspace";

export default async function StudyPage({ params }: { params: Promise<{ section: string }> }) {
	const { section } = await params;
	if (!["materials", "flashcards", "planner", "coding", "projects"].includes(section)) notFound();
	return <StudyWorkspace section={section as StudySection} />;
}
