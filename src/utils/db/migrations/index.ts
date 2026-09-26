import { subscribers } from "@/utils/db/migrations/001-subscribers";
import { slots } from "@/utils/db/migrations/002-slots";
import { alerts } from "@/utils/db/migrations/003-alerts";
import { staleAlerts } from "@/utils/db/migrations/004-stale-alerts";
import { slotHistory } from "@/utils/db/migrations/005-slot-history";
import { subscriberNotify } from "@/utils/db/migrations/006-subscriber-notify";
import type { Migration } from "@/utils/db/types";

export const migrations: readonly Migration[] = [
	subscribers,
	slots,
	alerts,
	staleAlerts,
	slotHistory,
	subscriberNotify,
];
