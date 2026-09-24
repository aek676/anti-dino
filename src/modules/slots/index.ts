export {
	formatCurrentSlotsMessage,
	formatNewSlotsMessage,
	formatUpdatedMessage,
	slotKey,
} from "./format";
export { SlotsModel } from "./model";
export { createSlotsRepository, type SlotsRepository } from "./repository";
export {
	bookingLinks,
	createSlotsService,
	type SlotsConfig,
	type SlotsDeps,
	watchTarget,
} from "./service";
