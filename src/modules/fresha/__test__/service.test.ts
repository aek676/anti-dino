import { describe, expect, test } from "bun:test";
import { FreshaError } from "@/modules/fresha/model";
import {
	createFreshaService,
	type FetchFn,
	parseServices,
} from "@/modules/fresha/service";
import initialize from "./fixtures/initialize.json";

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
