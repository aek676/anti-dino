import { subscribers } from "@/utils/db/migrations/001-subscribers";
import { slots } from "@/utils/db/migrations/002-slots";
import type { Migration } from "@/utils/db/types";

export const migrations: readonly Migration[] = [subscribers, slots];
