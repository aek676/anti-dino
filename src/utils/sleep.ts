export type Sleep = (ms: number) => Promise<void>;

export const sleep: Sleep = (ms) =>
	new Promise((resolve) => setTimeout(resolve, ms));
