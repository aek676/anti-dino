export {
	formatCurrentSlotsMessage,
	formatNewSlotsMessage,
	formatUpdatedMessage,
	slotKey,
} from "./format";
export {
	type BookingLinks,
	bookingLinks,
	type WatchTarget,
	watchTarget,
} from "./model";
export { createSlotsRepository, type SlotsRepository } from "./repository";
export { createSlotsService, type SlotsDeps } from "./service";
