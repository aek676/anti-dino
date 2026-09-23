import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { log } from "@/utils/logger";
import { FreshaError } from "../model";
import {
	createFreshaService,
	type FetchFn,
	parseEmployees,
	parseServices,
	parseSlots,
} from "../service";
import addService from "./fixtures/add-service.json";
import day from "./fixtures/day.json";
import employees from "./fixtures/employees.json";
import initialize from "./fixtures/initialize.json";
import time from "./fixtures/time.json";

const respond =
	(body: unknown, status = 200): FetchFn =>
	() =>
		Promise.resolve(Response.json(body, { status }));

const slug = "laclinica-la-gangosa-bulevar-ciudad-de-vicar-gg4e0gad";
const screen = initialize.data.bookingFlowInitialize.screenServices;

describe("parseServices", () => {
	test("extracts every bookable service with its variant id", () => {
		const services = parseServices(screen);

		expect(services).toHaveLength(7);
		expect(services[0]).toEqual({
			variantId: "sv:18605549",
			catalogId: "s:16131271",
			name: "Corte de pelo",
			duration: "30 mins",
			price: "from €10",
		});
	});

	test("collapses repeated whitespace in names", () => {
		expect(parseServices(screen)[1]?.name).toBe("Corte de pelo y barba");
	});

	test("skips items without an add action", () => {
		const item = screen.categories[0]?.items[0];
		if (!item) throw new Error("fixture has no items");

		const services = parseServices({
			categories: [{ items: [{ ...item, secondaryAction: null }] }],
		});

		expect(services).toEqual([]);
	});
});

describe("listServices", () => {
	test("sends the persisted query and parses the catalogue", async () => {
		const calls: RequestInit[] = [];
		const fetchFn: FetchFn = (_, init) => {
			calls.push(init);
			return Promise.resolve(Response.json(initialize));
		};

		const result = await createFreshaService(fetchFn).listServices(slug);

		expect(result).toHaveLength(7);

		const body = JSON.parse(calls[0]?.body as string);

		expect(body.operationName).toBe("BookingFlow_Initialize_Mutation");
		expect(body.variables.input.locationSlug).toBe(slug);
		expect(body.extensions.persistedQuery.sha256Hash).toHaveLength(64);
	});

	test("returns an http error when Fresha is down", async () => {
		const result = await createFreshaService(respond({}, 503)).listServices(
			slug,
		);

		expect(result).toBeInstanceOf(FreshaError);
		expect(result).toMatchObject({ kind: "http" });
	});

	test("keeps the Retry-After of a rate limited response", async () => {
		const rateLimited: FetchFn = () =>
			Promise.resolve(
				Response.json({}, { status: 429, headers: { "retry-after": "711" } }),
			);

		const result = await createFreshaService(rateLimited).listServices(slug);

		expect(result).toMatchObject({ status: 429, retryAfterSeconds: 711 });
	});

	test("leaves the Retry-After empty when Fresha does not send one", async () => {
		const result = await createFreshaService(respond({}, 429)).listServices(
			slug,
		);

		expect(result).toMatchObject({ status: 429 });
		expect((result as FreshaError).retryAfterSeconds).toBeUndefined();
	});

	test("returns a graphql error when the response carries errors", async () => {
		const result = await createFreshaService(
			respond({ data: null, errors: [{ message: "Location not found" }] }),
		).listServices(slug);

		expect(result).toMatchObject({ kind: "graphql" });
	});

	test("flags a stale persisted query hash", async () => {
		const result = await createFreshaService(
			respond({ data: null, errors: [{ message: "PersistedQueryNotFound" }] }),
		).listServices(slug);

		expect(result).toMatchObject({ kind: "unknown-operation" });
	});
});

describe("parseEmployees", () => {
	const screen = employees.data.bookingFlowActionButtonPressed.screenEmployee;

	test("keeps only real professionals, dropping the 'any' tile", () => {
		expect(parseEmployees(screen)).toEqual([
			{ id: 5236325, name: "Sergio" },
			{ id: 3182031, name: "Elvis" },
		]);
	});
});

describe("listEmployees", () => {
	const sequence = (bodies: unknown[]) => {
		const calls: {
			operationName: string;
			variables: Record<string, unknown>;
		}[] = [];
		const fetchFn: FetchFn = (_, init) => {
			calls.push(JSON.parse(init.body as string));
			const body = bodies[calls.length - 1];
			return Promise.resolve(Response.json(body));
		};
		return { fetchFn, calls };
	};

	test("adds the service, continues, and parses the professionals", async () => {
		const { fetchFn, calls } = sequence([initialize, addService, employees]);

		const result = await createFreshaService(fetchFn).listEmployees(
			slug,
			"sv:18605549",
		);

		expect(result).toEqual([
			{ id: 5236325, name: "Sergio" },
			{ id: 3182031, name: "Elvis" },
		]);
		expect(calls.map((c) => c.operationName)).toEqual([
			"BookingFlow_Initialize_Mutation",
			"BookingFlow_ActionButtonPressed_Mutation",
			"BookingFlow_ActionButtonPressed_Mutation",
		]);
		const cartId = initialize.data.bookingFlowInitialize.cartId;
		expect(calls[1]?.variables).toMatchObject({ cartId });
		expect(calls[1]?.variables.id).toContain(
			"onScreenServicesServiceVariantAdd",
		);
		expect(calls[1]?.variables.id).toContain("sv:18605549");
		expect(calls[2]?.variables).toMatchObject({ cartId });
		expect(calls[2]?.variables.id).toContain("onScreenServicesContinue");
	});

	test("fails when the variant is not in the catalogue", async () => {
		const { fetchFn, calls } = sequence([initialize]);

		const result = await createFreshaService(fetchFn).listEmployees(
			slug,
			"sv:0",
		);

		expect(result).toMatchObject({ kind: "graphql" });
		expect(calls).toHaveLength(1);
	});

	test("fails when Fresha rejects an action with an error toast", async () => {
		const rejected = {
			data: {
				bookingFlowActionButtonPressed: {
					...addService.data.bookingFlowActionButtonPressed,
					toasts: [{ __typename: "BookingFlowToastError" }],
				},
			},
		};
		const { fetchFn } = sequence([initialize, rejected]);

		const result = await createFreshaService(fetchFn).listEmployees(
			slug,
			"sv:18605549",
		);

		expect(result).toBeInstanceOf(FreshaError);
	});

	test("propagates transport errors from any step", async () => {
		const { fetchFn } = sequence([
			initialize,
			{ data: null, errors: [{ message: "boom" }] },
		]);

		const result = await createFreshaService(fetchFn).listEmployees(
			slug,
			"sv:18605549",
		);

		expect(result).toMatchObject({
			kind: "graphql",
			message: expect.stringContaining("boom"),
		});
	});

	test("fails when the services screen has no continue action", async () => {
		const stuck = structuredClone(addService);
		Object.assign(stuck.data.bookingFlowActionButtonPressed.screenServices, {
			continueAction: null,
		});
		const { fetchFn } = sequence([initialize, stuck]);

		const result = await createFreshaService(fetchFn).listEmployees(
			slug,
			"sv:18605549",
		);

		expect(result).toMatchObject({
			kind: "graphql",
			message: "services screen has no continue action",
		});
	});
});

describe("parseSlots", () => {
	test("returns every timeslot of an available day with its date", () => {
		const slots = parseSlots(
			"2026-09-08",
			day.data.bookingFlowActionButtonPressed.screenTime.day,
		);

		expect(slots).toHaveLength(14);
		expect(slots[0]).toEqual({ date: "2026-09-08", time: "12:15" });
	});

	test("returns nothing for a fully booked day", () => {
		const slots = parseSlots(
			"2026-09-05",
			time.data.bookingFlowActionButtonPressed.screenTime.day,
		);

		expect(slots).toEqual([]);
	});
});

describe("listSlots", () => {
	const router = (overrides: Record<string, unknown> = {}) => {
		const pressed: Record<string, unknown>[] = [];
		const fetchFn: FetchFn = (_, init) => {
			const body = JSON.parse(init.body as string);
			if (body.operationName === "BookingFlow_Initialize_Mutation") {
				return Promise.resolve(Response.json(initialize));
			}
			const [action] = JSON.parse(body.variables.id);
			pressed.push(action);
			const responses: Record<string, unknown> = {
				onScreenServicesServiceVariantAdd: addService,
				onScreenServicesContinue: employees,
				onScreenEmployeeSet: employees,
				onScreenEmployeeContinue: time,
				onScreenTimeDaySelectorDateSet: day,
				...overrides,
			};
			return Promise.resolve(Response.json(responses[action.type]));
		};
		return { fetchFn, pressed };
	};

	test("selects the employee and opens the days that may have slots", async () => {
		const { fetchFn, pressed } = router();

		const result = await createFreshaService(fetchFn).listSlots(
			slug,
			"sv:18605549",
			3182031,
			31,
		);

		expect(pressed.map((a) => a.type)).toEqual([
			"onScreenServicesServiceVariantAdd",
			"onScreenServicesContinue",
			"onScreenEmployeeSet",
			"onScreenEmployeeContinue",
			...Array<string>(21).fill("onScreenTimeDaySelectorDateSet"),
		]);
		expect(pressed[2]).toMatchObject({ employeeId: 3182031 });
		expect(pressed[4]).toMatchObject({ date: "2026-09-08" });

		expect(result).toHaveLength(21 * 14);
		expect(result).toContainEqual({ date: "2026-09-08", time: "12:15" });
	});

	test("stops opening loading days once one of them resolves the rest", async () => {
		const resolved = structuredClone(day);
		const screenTime = resolved.data.bookingFlowActionButtonPressed.screenTime;
		Object.assign(screenTime, {
			dates: screenTime.dates.map((entry) =>
				entry.isLoading
					? {
							...entry,
							isLoading: false,
							isAvailableToBeBooked: entry.date.iso.startsWith("2026-09-24"),
						}
					: entry,
			),
		});
		const { fetchFn, pressed } = router();
		const resolving: FetchFn = (url, init) =>
			(init.body as string).includes('\\"date\\":\\"2026-09-24\\"')
				? Promise.resolve(Response.json(resolved))
				: fetchFn(url, init);

		const result = await createFreshaService(resolving).listSlots(
			slug,
			"sv:18605549",
			3182031,
			31,
		);

		const opened = pressed
			.filter((a) => a.type === "onScreenTimeDaySelectorDateSet")
			.map((a) => a.date);
		expect(opened).toHaveLength(9);
		expect(opened).not.toContain("2026-09-25");
		expect(result).toHaveLength(10 * 14);
		expect(result).toContainEqual({ date: "2026-09-24", time: "12:15" });
	});

	test("hands back the Retry-After of a 429 that hits halfway through the days", async () => {
		const warn = spyOn(log, "warn");
		const { fetchFn } = router();
		const limited: FetchFn = (url, init) =>
			(init.body as string).includes('\\"date\\":\\"2026-09-10\\"')
				? Promise.resolve(
						Response.json(
							{},
							{ status: 429, headers: { "retry-after": "711" } },
						),
					)
				: fetchFn(url, init);

		const result = await createFreshaService(limited).listSlots(
			slug,
			"sv:18605549",
			3182031,
			31,
		);

		expect(result).toMatchObject({ status: 429, retryAfterSeconds: 711 });
		expect(warn).toHaveBeenCalledWith(
			{
				operation: "BookingFlow_ActionButtonPressed_Mutation",
				action: "onScreenTimeDaySelectorDateSet",
				retryAfterSeconds: 711,
			},
			"fresha rate limited",
		);
		warn.mockRestore();
	});

	test("reads the preselected day from the time screen instead of pressing it", async () => {
		const preselected = structuredClone(time);
		const screenTime =
			preselected.data.bookingFlowActionButtonPressed.screenTime;
		const dates = screenTime.dates.map((entry, index) => ({
			...entry,
			isSelected: index === 3,
			action: index === 3 ? null : entry.action,
		}));
		Object.assign(screenTime, {
			dates,
			day: day.data.bookingFlowActionButtonPressed.screenTime.day,
		});
		const { fetchFn, pressed } = router({
			onScreenEmployeeContinue: preselected,
		});

		const result = await createFreshaService(fetchFn).listSlots(
			slug,
			"sv:18605549",
			3182031,
			5,
		);

		expect(
			pressed.filter((a) => a.type === "onScreenTimeDaySelectorDateSet"),
		).toEqual([expect.objectContaining({ date: "2026-09-09" })]);
		expect(result).toHaveLength(2 * 14);
		expect(result).toContainEqual({ date: "2026-09-08", time: "12:15" });
	});

	test("fails when the employee screen has no continue action", async () => {
		const stuck = structuredClone(employees);
		Object.assign(stuck.data.bookingFlowActionButtonPressed.screenEmployee, {
			continueAction: null,
		});
		const { fetchFn, pressed } = router({ onScreenEmployeeSet: stuck });

		const result = await createFreshaService(fetchFn).listSlots(
			slug,
			"sv:18605549",
			3182031,
			31,
		);

		expect(result).toMatchObject({
			kind: "graphql",
			message: "employee screen has no continue action",
		});
		expect(pressed.map((a) => a.type)).toEqual([
			"onScreenServicesServiceVariantAdd",
			"onScreenServicesContinue",
			"onScreenEmployeeSet",
		]);
	});

	test("waits stepDelayMs between the days it opens, not before the first", async () => {
		const { fetchFn } = router();
		const waits: number[] = [];
		const sleep = (ms: number) => {
			waits.push(ms);
			return Promise.resolve();
		};

		const result = await createFreshaService(fetchFn, {
			stepDelayMs: 1500,
			sleep,
		}).listSlots(slug, "sv:18605549", 3182031, 5);

		expect(result).toHaveLength(2 * 14);
		expect(waits).toEqual([1500]);
	});

	test("looks only daysAhead days into the future", async () => {
		const { fetchFn, pressed } = router();

		const result = await createFreshaService(fetchFn).listSlots(
			slug,
			"sv:18605549",
			3182031,
			5,
		);

		expect(
			pressed.filter((a) => a.type === "onScreenTimeDaySelectorDateSet"),
		).toEqual([
			expect.objectContaining({ date: "2026-09-08" }),
			expect.objectContaining({ date: "2026-09-09" }),
		]);
		expect(result).toHaveLength(2 * 14);
	});

	test("fails when the employee is not offered for the service", async () => {
		const { fetchFn, pressed } = router();

		const result = await createFreshaService(fetchFn).listSlots(
			slug,
			"sv:18605549",
			1,
			31,
		);

		expect(result).toMatchObject({
			kind: "graphql",
			message: "employee 1 not found",
		});
		expect(pressed).toHaveLength(2);
	});

	test("stops at the first day Fresha rejects", async () => {
		const { fetchFn, pressed } = router();
		let opened = 0;
		const failing: FetchFn = (url, init) => {
			const body = JSON.parse(init.body as string);
			const action = body.variables.id ? JSON.parse(body.variables.id)[0] : {};
			if (action.type === "onScreenTimeDaySelectorDateSet" && ++opened === 2) {
				return Promise.resolve(
					Response.json({ data: null, errors: [{ message: "boom" }] }),
				);
			}
			return fetchFn(url, init);
		};

		const result = await createFreshaService(failing).listSlots(
			slug,
			"sv:18605549",
			3182031,
			31,
		);

		expect(result).toBeInstanceOf(FreshaError);
		expect(
			pressed.filter((a) => a.type === "onScreenTimeDaySelectorDateSet"),
		).toHaveLength(1);
	});
});

describe("rate limit cooldown", () => {
	let clock: Temporal.Instant;
	const counting = (responder: FetchFn) => {
		let calls = 0;
		const fetchFn: FetchFn = (url, init) => {
			calls++;
			return responder(url, init);
		};
		return {
			fetchFn,
			get calls() {
				return calls;
			},
		};
	};
	const rateLimited =
		(headers: Record<string, string> = {}): FetchFn =>
		() =>
			Promise.resolve(Response.json({}, { status: 429, headers }));

	beforeEach(() => {
		clock = Temporal.Instant.from("2026-09-14T10:00:00Z");
	});

	test("fails at once for 15 minutes after a 429 without Retry-After", async () => {
		const fetch = counting(rateLimited());
		const service = createFreshaService(fetch.fetchFn, { now: () => clock });

		expect(await service.listServices(slug)).toMatchObject({ status: 429 });
		expect(await service.listServices(slug)).toMatchObject({
			status: 429,
			retryAfterSeconds: 900,
		});
		expect(fetch.calls).toBe(1);
		expect(service.rateLimitedUntil()?.toString()).toBe("2026-09-14T10:15:00Z");

		clock = clock.add({ minutes: 15 });
		expect(service.rateLimitedUntil()).toBeNull();
		await service.listServices(slug);
		expect(fetch.calls).toBe(2);
	});

	test("waits exactly the Retry-After of the 429", async () => {
		const fetch = counting(rateLimited({ "retry-after": "711" }));
		const service = createFreshaService(fetch.fetchFn, { now: () => clock });

		await service.listServices(slug);
		clock = clock.add({ seconds: 710 });
		expect(await service.listServices(slug)).toMatchObject({
			status: 429,
			retryAfterSeconds: 1,
		});
		expect(fetch.calls).toBe(1);

		clock = clock.add({ seconds: 1 });
		await service.listServices(slug);
		expect(fetch.calls).toBe(2);
	});

	test("blocks only the operation that was rate limited", async () => {
		const fetch = counting((_, init) =>
			(init.body as string).includes("BookingFlow_Initialize_Mutation")
				? Promise.resolve(Response.json(initialize))
				: rateLimited()("", init),
		);
		const service = createFreshaService(fetch.fetchFn, { now: () => clock });

		expect(await service.listEmployees(slug, "sv:18605549")).toMatchObject({
			status: 429,
		});
		expect(fetch.calls).toBe(2);
		expect(service.rateLimitedUntil()).not.toBeNull();

		expect(await service.listServices(slug)).toHaveLength(7);
		expect(fetch.calls).toBe(3);

		expect(await service.listEmployees(slug, "sv:18605549")).toMatchObject({
			status: 429,
		});
		expect(fetch.calls).toBe(4);
	});
});

describe("prepareBooking", () => {
	const slot = { date: "2026-09-08", time: "12:15" };
	const cartId = initialize.data.bookingFlowInitialize.cartId;

	const selectedTime = () => {
		const screen = structuredClone(day);
		const { day: opened } =
			screen.data.bookingFlowActionButtonPressed.screenTime;
		opened.timeslots = opened.timeslots.map((entry) => ({
			...entry,
			isSelected: entry.time === slot.time,
		}));
		return screen;
	};

	const router = (overrides: Record<string, unknown> = {}) => {
		const calls: {
			operationName: string;
			variables: { id: string; cartId: string; input: unknown };
		}[] = [];
		const fetchFn: FetchFn = (_, init) => {
			const body = JSON.parse(init.body as string);
			calls.push(body);
			if (body.operationName === "BookingFlow_Initialize_Mutation") {
				return Promise.resolve(Response.json(initialize));
			}
			const [action] = JSON.parse(body.variables.id);
			const responses: Record<string, unknown> = {
				onScreenServicesContinue: day,
				onScreenTimeSet: selectedTime(),
				onScreenTimeContinue: day,
				...overrides,
			};
			const response = responses[action.type];
			return Promise.resolve(
				response instanceof Response ? response : Response.json(response),
			);
		};
		return { fetchFn, calls };
	};

	const prepare = (fetchFn: FetchFn, target = slot) =>
		createFreshaService(fetchFn).prepareBooking(
			slug,
			"sv:18605549",
			3182031,
			target,
		);

	test("leaves a cart with the slot selected in four calls", async () => {
		const { fetchFn, calls } = router();

		const result = await prepare(fetchFn);

		expect(result).toEqual({ cartId, selected: true });
		expect(calls.map((c) => c.operationName)).toEqual([
			"BookingFlow_Initialize_Mutation",
			"BookingFlow_ActionButtonPressed_Mutation",
			"BookingFlow_ActionButtonPressed_Mutation",
			"BookingFlow_ActionButtonPressed_Mutation",
		]);
		expect(calls[0]?.variables.input).toMatchObject({
			shouldAutoContinue: false,
			options: {
				isFromLinkBuilder: false,
				offerItems: ["sv:18605549"],
				employeeId: "3182031",
				preferredDate: "2026-09-08",
			},
		});

		const pressed = calls.slice(1).map((c) => JSON.parse(c.variables.id)[0]);
		expect(pressed.map((a) => a.type)).toEqual([
			"onScreenServicesContinue",
			"onScreenTimeSet",
			"onScreenTimeContinue",
		]);
		expect(pressed[1]).toMatchObject({ date: "2026-09-08", time: 44100 });
		expect(calls.slice(1).map((c) => c.variables.cartId)).toEqual([
			cartId,
			cartId,
			cartId,
		]);
	});

	test("stops at the time screen when Fresha no longer offers that hour", async () => {
		const { fetchFn, calls } = router();

		const result = await prepare(fetchFn, {
			date: "2026-09-08",
			time: "09:00",
		});

		expect(result).toEqual({ cartId, selected: false });
		expect(calls).toHaveLength(2);
	});

	test("stops at the time screen when it opens another day", async () => {
		const { fetchFn, calls } = router();

		const result = await prepare(fetchFn, {
			date: "2026-09-09",
			time: "12:15",
		});

		expect(result).toEqual({ cartId, selected: false });
		expect(calls).toHaveLength(2);
	});

	test("stops at the time screen when the hour does not stay selected", async () => {
		const { fetchFn, calls } = router({ onScreenTimeSet: day });

		const result = await prepare(fetchFn);

		expect(result).toEqual({ cartId, selected: false });
		expect(calls).toHaveLength(3);
	});

	test("fails when Fresha rejects a step with an error toast", async () => {
		const rejected = structuredClone(day);
		Object.assign(rejected.data.bookingFlowActionButtonPressed, {
			toasts: [{ __typename: "BookingFlowToastError" }],
		});
		const { fetchFn, calls } = router({ onScreenTimeContinue: rejected });

		const result = await prepare(fetchFn);

		expect(result).toBeInstanceOf(FreshaError);
		expect(calls).toHaveLength(4);
	});

	test("hands back a 429 without retrying", async () => {
		const { fetchFn, calls } = router({
			onScreenServicesContinue: Response.json(
				{},
				{ status: 429, headers: { "retry-after": "711" } },
			),
		});

		const result = await prepare(fetchFn);

		expect(result).toMatchObject({ status: 429, retryAfterSeconds: 711 });
		expect(calls).toHaveLength(2);
	});
});
