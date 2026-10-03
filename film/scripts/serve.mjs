/**
 * Local server for the film. Serves the film itself, Deckify's real assets straight from the repository (nothing is copied), and the real
 * Deckify Setup page with the film bridge injected (src/setup-bridge.js: a stand-in for the plugin's local API and a virtual clock).
 *
 *   npm run preview          → http://127.0.0.1:4321/?format=desktop  (or ?format=mobile)
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const FILM = path.resolve(import.meta.dirname, "..");
const ROOT = path.resolve(FILM, "..");
const PLUGIN = path.join(ROOT, "com.marting.deckify.sdPlugin");

const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
	".json": "application/json",
};

/** URL prefix → directory. Longest prefix wins. */
const MOUNTS = [
	["/film/", path.join(FILM, "src")],
	["/fonts/", path.join(FILM, "node_modules", "@fontsource", "inter", "files")],
	["/plugin/", PLUGIN],
	["/brand/", path.join(ROOT, "assets", "brand")],
	["/setup/onboarding.js", path.join(PLUGIN, "ui", "shared", "onboarding.js")],
	// The tour's icons, mapped as src/setup/setup-server.ts maps them.
	["/setup/icons/now-playing.svg", path.join(PLUGIN, "imgs", "actions", "playback", "now-playing-icon.svg")],
	["/setup/icons/like.svg", path.join(PLUGIN, "imgs", "actions", "library", "like-icon.svg")],
	["/setup/icons/playlists.svg", path.join(PLUGIN, "imgs", "actions", "playlist", "add-icon.svg")],
	["/setup/icons/volume.svg", path.join(PLUGIN, "imgs", "actions", "volume", "volume-up-icon.svg")],
	["/setup/", path.join(PLUGIN, "ui", "setup")],
];

/**
 * The real Deckify Setup page, with the film's bridge and presentation stylesheet added. The page's own markup, scripts and styles are
 * served unchanged.
 * @returns {Promise<string>} HTML.
 */
async function setupPage() {
	const html = await fs.readFile(path.join(PLUGIN, "ui", "setup", "index.html"), "utf8");
	const withStyle = html.replace("</head>", '\t<link rel="stylesheet" href="/film/setup-film.css" />\n\t</head>');
	const withBridge = withStyle.replace('<script src="/setup/onboarding.js"></script>', '<script src="/film/setup-bridge.js"></script>\n\t\t<script src="/setup/onboarding.js"></script>');
	if (withBridge === withStyle || withStyle === html) {
		throw new Error("Deckify Setup markup changed: update the bridge injection in film/scripts/serve.mjs.");
	}
	return withBridge;
}

/**
 * @param {string} urlPath Request path.
 * @returns {string | undefined} File on disk.
 */
function resolve(urlPath) {
	if (urlPath === "/" || urlPath === "/index.html") {
		return path.join(FILM, "src", "index.html");
	}
	const mount = MOUNTS.filter(([prefix]) => urlPath.startsWith(prefix)).sort((a, b) => b[0].length - a[0].length)[0];
	if (!mount) {
		return undefined;
	}
	const [prefix, dir] = mount;
	if (!prefix.endsWith("/")) {
		return dir;
	}
	const file = path.resolve(dir, decodeURIComponent(urlPath.slice(prefix.length)));
	return file.startsWith(dir) ? file : undefined;
}

/**
 * Starts the server.
 * @param {number} [port] Port (0 for any free port).
 * @returns {Promise<{url: string, close: () => Promise<void>}>} The server.
 */
export function startServer(port = 4321) {
	const server = http.createServer(async (req, res) => {
		const urlPath = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
		try {
			if (urlPath === "/setup/" || urlPath === "/setup/index.html") {
				res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-store" });
				res.end(await setupPage());
				return;
			}
			const file = resolve(urlPath);
			if (!file) {
				res.writeHead(404).end();
				return;
			}
			const body = await fs.readFile(file);
			res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
			res.end(body);
		} catch {
			res.writeHead(404).end();
		}
	});
	return new Promise((done) => {
		server.listen(port, "127.0.0.1", () => {
			const address = server.address();
			done({
				url: `http://127.0.0.1:${address.port}`,
				close: () => new Promise((closed) => server.close(() => closed())),
			});
		});
	});
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const { url } = await startServer(Number(process.env.PORT ?? 4321));
	console.log(`Deckify film preview: ${url}/?format=desktop  ·  ${url}/?format=mobile`);
}
