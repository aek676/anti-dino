export type ChatId = number;
export type MessageId = number;
export type Delivery = Map<ChatId, MessageId>;

export type LinkButton = { label: string; url: string };

/** `text` is Telegram HTML; escape anything that is not markup with `escapeHtml`. */
export type Message = { text: string; buttons?: LinkButton[][] };

export const escapeHtml = (text: string): string =>
	text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
