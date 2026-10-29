import { Home } from "@/components/home";
import { readSettingsRecord } from "@/src/server";
import { resolveSettings, slotsConfigured } from "@/src/core";

export const dynamic = "force-dynamic";

export default function GraphPage() {
	const record = readSettingsRecord();
	return <Home initialConfigured={slotsConfigured(record?.models)} rendering={resolveSettings(record ?? null).graph.rendering} />;
}
