import { FreshaError, type FreshaModel } from "@/modules/fresha/model";

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

export const createFreshaService = (fetchFn: FetchFn = fetch) => {
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
			return new FreshaError(`${name}: HTTP ${res.status}`, "http");
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

	return { listServices };
};
