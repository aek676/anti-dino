/**
 * iOS only opens the Fresha app from a link the user taps, never from a
 * redirect, so iPhones land here and tap through instead of being 302'd.
 */
export const openInFreshaPage = (url: string): string => {
	const href = Bun.escapeHTML(url);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Open in Fresha</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,system-ui,sans-serif;background:#fff;color:#111}
main{text-align:center;padding:24px}
a{display:inline-block;padding:16px 32px;border-radius:12px;background:#111;color:#fff;font-size:18px;font-weight:600;text-decoration:none}
p{color:#666;font-size:14px}
</style>
</head>
<body>
<main>
<a href="${href}">Open in Fresha</a>
<p>Your hour is waiting in the cart.</p>
</main>
</body>
</html>
`;
};
