import { describe, expect, test } from "bun:test";
import { FreshaError } from "@/modules/fresha/model";
import {
	createFreshaService,
	type FetchFn,
	parseEmployees,
	parseServices,
	parseSlots,
} from "@/modules/fresha/service";
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
	const router = (timeScreen: unknown = time) => {
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
				onScreenEmployeeContinue: timeScreen,
				onScreenTimeDaySelectorDateSet: day,
			};
			return Promise.resolve(Response.json(responses[action.type]));
		};
		return { fetchFn, pressed };
	};

	test("selects the employee and opens only the available days", async () => {
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
			...Array<string>(24).fill("onScreenTimeDaySelectorDateSet"),
		]);
		expect(pressed[2]).toMatchObject({ employeeId: 3182031 });
		expect(pressed[4]).toMatchObject({ date: "2026-09-08" });

		expect(result).toHaveLength(24 * 14);
		expect(result).toContainEqual({ date: "2026-09-08", time: "12:15" });
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
		const { fetchFn, pressed } = router(preselected);

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
