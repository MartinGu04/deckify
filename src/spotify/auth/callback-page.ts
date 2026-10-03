import { DECKIFY_VIOLET } from "../../shared/brand";

/**
 * Tone of a callback page.
 */
export type CallbackPageTone = "success" | "denied" | "error";

const ACCENT: Record<CallbackPageTone, string> = {
	success: DECKIFY_VIOLET,
	denied: "#F5B83D",
	error: "#FF6B6B",
};

const HEADING: Record<CallbackPageTone, string> = {
	success: "Connected",
	denied: "Not connected",
	error: "Something went wrong",
};

/**
 * Renders the small, self-contained page shown in the browser after Spotify redirects back to Deckify. It loads no external resources.
 * @param tone Outcome of the callback.
 * @param message Message to display; HTML-escaped.
 * @returns The HTML document.
 */
export function renderCallbackPage(tone: CallbackPageTone, message: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Deckify · ${escapeHtml(HEADING[tone])}</title>
<style>
	:root { color-scheme: dark; }
	body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d0d0d; color: #f2f2f2;
		font: 16px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif; }
	main { max-width: 420px; padding: 32px; text-align: center; }
	.brand { font-weight: 800; letter-spacing: 0.08em; font-size: 28px; margin: 0 0 24px; }
	.brand span { color: ${DECKIFY_VIOLET}; }
	.status { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 13px; font-weight: 600;
		color: #0d0d0d; background: ${ACCENT[tone]}; margin-bottom: 16px; }
	p { margin: 0; color: #cfcfcf; }
</style>
</head>
<body>
<main>
	<p class="brand">DECK<span>IFY</span></p>
	<div class="status">${escapeHtml(HEADING[tone])}</div>
	<p>${escapeHtml(message)}</p>
</main>
</body>
</html>
`;
}

/**
 * Escapes text for inclusion in HTML.
 * @param value Text.
 * @returns Escaped text.
 */
function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
