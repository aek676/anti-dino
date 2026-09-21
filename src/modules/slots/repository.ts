import type { ChatId, Delivery, MessageId } from "@/modules/telegram";
import type { Db } from "@/utils/db";
import type { WatchTarget } from "./model";

export type SlotsRepository = ReturnType<typeof createSlotsRepository>;

export const createSlotsRepository = (db: Db) => {
	const selectSlotStartTimes = db.query<{ starts_at: string }, WatchTarget>(
		"SELECT starts_at FROM slots WHERE employee_id = :employeeId AND service_id = :serviceId AND gone_at IS NULL ORDER BY starts_at",
	);

	const insertSlot = db.query<
		void,
		WatchTarget & { startsAt: string; seenAt: string }
	>(
		`INSERT OR IGNORE INTO slots (employee_id, service_id, starts_at, seen_at, last_seen_at)
		 VALUES (:employeeId, :serviceId, :startsAt, :seenAt, :seenAt)`,
	);

	const updateSlotsGone = db.query<
		void,
		WatchTarget & { goneStartTimes: string; seenAt: string }
	>(
		`UPDATE slots SET gone_at = :seenAt
		 WHERE employee_id = :employeeId AND service_id = :serviceId AND gone_at IS NULL
		   AND starts_at IN (SELECT value FROM json_each(:goneStartTimes))`,
	);

	const updateSlotsLastSeen = db.query<
		void,
		WatchTarget & { goneStartTimes: string; seenAt: string }
	>(
		`UPDATE slots SET last_seen_at = :seenAt
		 WHERE employee_id = :employeeId AND service_id = :serviceId AND gone_at IS NULL
		   AND starts_at NOT IN (SELECT value FROM json_each(:goneStartTimes))`,
	);

	const insertAlert = db.query<
		void,
		WatchTarget & { chatId: ChatId; messageId: MessageId; startsAt: string }
	>(
		`INSERT OR IGNORE INTO alerts (chat_id, message_id, employee_id, service_id, starts_at) VALUES (:chatId, :messageId, :employeeId, :serviceId, :startsAt)`,
	);

	const selectAlertMessages = db.query<
		{ chat_id: ChatId; message_id: MessageId },
		WatchTarget & { startTimes: string }
	>(
		`SELECT DISTINCT chat_id, message_id FROM alerts
		 WHERE employee_id = :employeeId AND service_id = :serviceId
		   AND (stale = 1 OR starts_at IN (SELECT value FROM json_each(:startTimes)))`,
	);

	const updateAlertStale = db.query<
		void,
		{ chatId: ChatId; messageId: MessageId; stale: number }
	>(
		"UPDATE alerts SET stale = :stale WHERE chat_id = :chatId AND message_id = :messageId",
	);

	const selectAlertStartTimes = db.query<
		{ starts_at: string },
		{ chatId: ChatId; messageId: MessageId }
	>(
		"SELECT starts_at FROM alerts WHERE chat_id = :chatId AND message_id = :messageId ORDER BY starts_at",
	);

	const deleteAlertsStartingBefore = db.query<void, { before: string }>(
		`DELETE FROM alerts WHERE starts_at < :before`,
	);

	const listSlotStartTimes = (target: WatchTarget): string[] =>
		selectSlotStartTimes.all(target).map((row) => row.starts_at);

	const insertSlots = db.transaction(
		(target: WatchTarget, startTimes: string[], seenAt: string) => {
			for (const startsAt of startTimes) {
				insertSlot.run({ ...target, startsAt, seenAt });
			}
		},
	);

	const reconcileKnownSlots = db.transaction(
		(target: WatchTarget, goneStartTimes: string[], seenAt: string) => {
			const params = {
				...target,
				goneStartTimes: JSON.stringify(goneStartTimes),
				seenAt,
			};
			updateSlotsGone.run(params);
			updateSlotsLastSeen.run(params);
		},
	);

	const insertAlerts = db.transaction(
		(delivery: Delivery, target: WatchTarget, startTimes: string[]) => {
			for (const [chatId, messageId] of delivery) {
				for (const startsAt of startTimes) {
					insertAlert.run({ ...target, chatId, messageId, startsAt });
				}
			}
		},
	);

	const listAlertMessagesToEdit = (
		target: WatchTarget,
		startTimes: string[],
	): { chatId: ChatId; messageId: MessageId }[] =>
		selectAlertMessages
			.all({ ...target, startTimes: JSON.stringify(startTimes) })
			.map((row) => ({ chatId: row.chat_id, messageId: row.message_id }));

	const markAlertStale = (
		chatId: ChatId,
		messageId: MessageId,
		stale: boolean,
	) => {
		updateAlertStale.run({ chatId, messageId, stale: stale ? 1 : 0 });
	};

	const listAlertStartTimes = (
		chatId: ChatId,
		messageId: MessageId,
	): string[] =>
		selectAlertStartTimes
			.all({ chatId, messageId })
			.map((row) => row.starts_at);

	const deleteAlertsBefore = (before: string) => {
		deleteAlertsStartingBefore.run({ before });
	};

	return {
		listSlotStartTimes,
		insertSlots,
		reconcileKnownSlots,
		insertAlerts,
		listAlertMessagesToEdit,
		markAlertStale,
		listAlertStartTimes,
		deleteAlertsBefore,
	};
};
