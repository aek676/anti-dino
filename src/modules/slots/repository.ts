import type { ChatId, Delivery, MessageId } from "@/modules/telegram";
import type { Db } from "@/utils/db";
import type { WatchTarget } from "./model";

export const createSlotsRepository = (db: Db) => {
	const selectSlotStartTimes = db.query<{ starts_at: string }, WatchTarget>(
		"SELECT starts_at FROM slots WHERE employee_id = :employeeId AND service_id = :serviceId ORDER BY starts_at",
	);

	const insertSlot = db.query<
		void,
		WatchTarget & { startsAt: string; seenAt: string }
	>(
		`INSERT OR IGNORE INTO slots (employee_id, service_id, starts_at, seen_at)
		 VALUES (:employeeId, :serviceId, :startsAt, :seenAt)`,
	);

	const deleteSlot = db.query<void, WatchTarget & { startsAt: string }>(
		`DELETE FROM slots WHERE employee_id = :employeeId AND service_id = :serviceId AND starts_at = :startsAt`,
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
		   AND starts_at IN (SELECT value FROM json_each(:startTimes))`,
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

	const deleteSlots = db.transaction(
		(target: WatchTarget, startTimes: string[]) => {
			for (const startsAt of startTimes) {
				deleteSlot.run({ ...target, startsAt });
			}
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

	const listAlertMessages = (
		target: WatchTarget,
		startTimes: string[],
	): { chatId: ChatId; messageId: MessageId }[] => {
		if (startTimes.length === 0) return [];

		return selectAlertMessages
			.all({ ...target, startTimes: JSON.stringify(startTimes) })
			.map((row) => ({ chatId: row.chat_id, messageId: row.message_id }));
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
		deleteSlots,
		insertAlerts,
		listAlertMessages,
		listAlertStartTimes,
		deleteAlertsBefore,
	};
};
