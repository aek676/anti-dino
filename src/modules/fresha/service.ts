import { FreshaError, type FreshaModel } from "@/modules/fresha/model";
import { sleep as defaultSleep, type Sleep } from "@/utils/sleep";

const ENDPOINT = "https://www.fresha.com/graphql";

const OPERATIONS = {
	initialize: {
		name: "BookingFlow_Initialize_Mutation",
		hash: "02d5d8ce34389c6f0a8fb062c0a6b30c1749508c053bd79b4e396b03d5d0014e",
	},
	actionButtonPressed: {
		name: "BookingFlow_ActionButtonPressed_Mutation",
		hash: "93c58971c704f87497d4cbf391df04eb0da5275116e27345866052f8523904f9",
	},
	timeScrollEnd: {
		name: "BookingFlow_TimeScrollEnd_Mutation",
		hash: "05d737a1ff85f3304b76ed1bb90732448abe03824ab85c926b961f1436e7a687",
	},
} as const;

type Operation = keyof typeof OPERATIONS;

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

type GraphqlResponse<T> = {
	data: T | null;
	errors?: { message: string }[];
};

type ServicesScreen = {
	categories: {
		items: {
			name: string;
			caption: string | null;
			price: { formatted: string } | null;
			secondaryAction: { id: string } | null;
		}[];
	}[];
};

type InitializeResult = {
	bookingFlowInitialize: {
		cartId: string;
		screenServices: ServicesScreen;
	};
};

type EmployeeScreen = {
	continueAction?: { id: string };
	employees: {
		__typename: string;
		name?: string;
		action: { id: string } | null;
	}[];
};

type TimeScreen = {
	dates: {
		date: { iso: string };
		isAvailableToBeBooked: boolean;
		action: { id: string } | null;
	}[];
	day: {
		__typename: string;
		timeslots?: { time: string }[];
	};
};

type ActionResult = {
	bookingFlowActionButtonPressed: {
		cartId: string;
		toasts: { __typename: string }[];
		screenServices: { continueAction?: { id: string } };
		screenEmployee: Partial<EmployeeScreen>;
		screenTime: Partial<TimeScreen>;
	};
};

const Typename = {
	employeeTile: "BookingFlowScreenEmployeeTileEmployee",
	dayAvailable: "BookingFlowScreenTimeDayAvailable",
	toastError: "BookingFlowToastError",
} as const;

const CAPABILITIES = [
	"SERVICE_ADDONS",
	"CONFIRMATION",
	"FULL_UPFRONT_PAYMENT",
	"MARKETPLACE_REFRESH",
	"DISCOUNTS_AND_BENEFITS",
	"LOYALTY_POINTS_STORE",
	"TEAM_MEMBER_GENDER",
];

const parseActionId = (id: string): Record<string, unknown> => {
	const parsed: unknown = JSON.parse(id);
	const first = Array.isArray(parsed) ? parsed[0] : null;
	return first && typeof first === "object"
		? (first as Record<string, unknown>)
		: {};
};

export const parseServices = (
	screen: ServicesScreen,
): FreshaModel["service"][] =>
	screen.categories.flatMap((category) =>
		category.items.flatMap((item) => {
			if (!item.secondaryAction) return [];
			const { bookableId, catalogId } = parseActionId(item.secondaryAction.id);
			if (typeof bookableId !== "string" || typeof catalogId !== "string") {
				return [];
			}
			return [
				{
					variantId: bookableId,
					catalogId,
					name: item.name.replace(/\s+/g, " ").trim(),
					duration: item.caption,
					price: item.price?.formatted ?? null,
				},
			];
		}),
	);

export const parseEmployees = (
	screen: EmployeeScreen,
): FreshaModel["employee"][] =>
	screen.employees.flatMap((tile) => {
		if (tile.__typename !== Typename.employeeTile) return [];
		if (!tile.action || !tile.name) return [];

		const { employeeId } = parseActionId(tile.action.id);
		return typeof employeeId === "number"
			? [{ id: employeeId, name: tile.name }]
			: [];
	});

export const parseSlots = (
	date: string,
	day: TimeScreen["day"],
): FreshaModel["slot"][] =>
	day.__typename === Typename.dayAvailable
		? (day.timeslots ?? []).map((slot) => ({ date, time: slot.time }))
		: [];

export type FreshaOptions = {
	stepDelayMs?: number;
	sleep?: Sleep;
};

export const createFreshaService = (
	fetchFn: FetchFn = fetch,
	{ stepDelayMs = 0, sleep = defaultSleep }: FreshaOptions = {},
) => {
	const call = async <T>(
		operation: Operation,
		variables: Record<string, unknown>,
	): Promise<T | FreshaError> => {
		const { name, hash } = OPERATIONS[operation];
		const res = await fetchFn(ENDPOINT, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json",
				origin: "https://www.fresha.com",
				"x-client-platform": "web",
				"x-graphql-operation-name": name,
				"user-agent":
					"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
			},
			body: JSON.stringify({
				operationName: name,
				variables,
				extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
			}),
		});

		if (!res.ok) {
			return new FreshaError(`${name}: HTTP ${res.status}`, "http", res.status);
		}

		const body = (await res.json()) as GraphqlResponse<T>;
		if (body.errors?.length || body.data === null) {
			const message =
				body.errors?.map((e) => e.message).join("; ") ?? "no data";
			const kind = /persisted ?query/i.test(message)
				? "unknown-operation"
				: "graphql";
			return new FreshaError(`${name}: ${message}`, kind);
		}
		return body.data;
	};

	const press = async (actionId: string, cartId: string) => {
		const data = await call<ActionResult>("actionButtonPressed", {
			id: actionId,
			cartId,
			shouldAutoContinue: true,
			withRecommendedServices: false,
		});
		if (data instanceof FreshaError) return data;
		const result = data.bookingFlowActionButtonPressed;
		return result.toasts.some((t) => t.__typename === Typename.toastError)
			? new FreshaError("action rejected by Fresha", "graphql")
			: result;
	};

	const initialize = async (locationSlug: string) => {
		const data = await call<InitializeResult>("initialize", {
			withRecommendedServices: false,
			input: {
				locationSlug,
				referer: `https://www.fresha.com/es/a/${locationSlug}/all-offer`,
				options: {
					isFromLinkBuilder: true,
					shouldShowAllEmployees: false,
					isGroupBooking: false,
					isRebook: false,
				},
				shouldAutoContinue: true,
				capabilities: CAPABILITIES,
			},
		});
		return data instanceof FreshaError ? data : data.bookingFlowInitialize;
	};

	const listServices = async (
		locationSlug: string,
	): Promise<FreshaModel["service"][] | FreshaError> => {
		const result = await initialize(locationSlug);
		return result instanceof FreshaError
			? result
			: parseServices(result.screenServices);
	};

	const openCart = async (locationSlug: string, variantId: string) => {
		const init = await initialize(locationSlug);
		if (init instanceof FreshaError) return init;

		const addAction = init.screenServices.categories
			.flatMap((category) => category.items)
			.find(
				(item) =>
					item.secondaryAction &&
					parseActionId(item.secondaryAction.id).bookableId === variantId,
			)?.secondaryAction;
		if (!addAction)
			return new FreshaError(`service ${variantId} not found`, "graphql");

		const added = await press(addAction.id, init.cartId);
		if (added instanceof FreshaError) return added;

		const continueAction = added.screenServices.continueAction;
		if (!continueAction)
			return new FreshaError(
				"services screen has no continue action",
				"graphql",
			);

		const employees = await press(continueAction.id, init.cartId);
		if (employees instanceof FreshaError) return employees;

		const screen = employees.screenEmployee;
		if (!screen.employees)
			return new FreshaError("employees screen not reached", "graphql");

		return { cartId: init.cartId, screen: screen as EmployeeScreen };
	};

	const listEmployees = async (
		locationSlug: string,
		variantId: string,
	): Promise<FreshaModel["employee"][] | FreshaError> => {
		const cart = await openCart(locationSlug, variantId);
		return cart instanceof FreshaError ? cart : parseEmployees(cart.screen);
	};

	const listSlots = async (
		locationSlug: string,
		variantId: string,
		employeeId: number,
		daysAhead: number,
	): Promise<FreshaModel["slot"][] | FreshaError> => {
		const cart = await openCart(locationSlug, variantId);
		if (cart instanceof FreshaError) return cart;

		const employeeAction = cart.screen.employees.find(
			(tile) =>
				tile.action && parseActionId(tile.action.id).employeeId === employeeId,
		)?.action;
		if (!employeeAction)
			return new FreshaError(`employee ${employeeId} not found`, "graphql");

		const selected = await press(employeeAction.id, cart.cartId);
		if (selected instanceof FreshaError) return selected;

		const continueAction = selected.screenEmployee.continueAction;
		if (!continueAction)
			return new FreshaError(
				"employee screen has no continue action",
				"graphql",
			);

		const time = await press(continueAction.id, cart.cartId);
		if (time instanceof FreshaError) return time;

		const dates = time.screenTime.dates;
		if (!dates) return new FreshaError("time screen has no reached", "graphql");

		const slots: FreshaModel["slot"][] = [];
		let opened = 0;
		for (const entry of dates.slice(0, daysAhead)) {
			if (!entry.isAvailableToBeBooked) continue;
			const date = entry.date.iso.slice(0, 10);

			if (!entry.action) {
				const day = time.screenTime.day;
				if (!day) return new FreshaError(`day ${date} not reached`, "graphql");
				slots.push(...parseSlots(date, day));
				continue;
			}

			if (opened++ > 0 && stepDelayMs > 0) await sleep(stepDelayMs);
			const pressed = await press(entry.action.id, cart.cartId);
			if (pressed instanceof FreshaError) return pressed;

			const day = pressed.screenTime.day;
			if (!day) return new FreshaError(`day ${date} not reached`, "graphql");
			slots.push(...parseSlots(date, day));
		}
		return slots;
	};

	return { listServices, listEmployees, listSlots };
};
