import { dirname, join } from "node:path";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/**
 * Resolve the installed pi coding agent package root directory.
 *
 * Pi extensions run inside pi's Node.js process via jiti, so module resolution
 * should normally work against pi's own module graph. Prefer resolving the
 * exported package entry because `package.json` is not exported by pi.
 */
let cachedRoot: string | undefined;

function looksLikePiPackageRoot(dir: string): boolean {
	const pkg = join(dir, "package.json");
	if (!existsSync(pkg)) return false;
	try {
		const content = JSON.parse(readFileSync(pkg, "utf8"));
		return content.name === "@mariozechner/pi-coding-agent";
	} catch {
		return false;
	}
}

function tryResolveFromModuleGraph(): string | undefined {
	try {
		const entryPath = require.resolve("@mariozechner/pi-coding-agent");
		const candidate = dirname(dirname(entryPath));
		if (looksLikePiPackageRoot(candidate)) return candidate;
	} catch {
		// Continue to other strategies.
	}
	return undefined;
}

function tryResolveFromBinaryPath(): string | undefined {
	const argvEntry = process.argv[1];
	if (!argvEntry) return undefined;

	try {
		const realEntry = realpathSync(argvEntry);
		let dir = dirname(realEntry);
		while (dir !== dirname(dir)) {
			if (looksLikePiPackageRoot(dir)) return dir;
			dir = dirname(dir);
		}
	} catch {
		// Continue to other strategies.
	}
	return undefined;
}

function tryResolveFromPlatformFallbacks(): string | undefined {
	const home = process.env.HOME || process.env.USERPROFILE;
	const appData = process.env.APPDATA;
	const candidates = [
		"/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent",
		"/usr/local/lib/node_modules/@mariozechner/pi-coding-agent",
		appData ? join(appData, "npm", "node_modules", "@mariozechner", "pi-coding-agent") : undefined,
		home ? join(home, "AppData", "Roaming", "npm", "node_modules", "@mariozechner", "pi-coding-agent") : undefined,
	].filter((value): value is string => Boolean(value));

	return candidates.find(looksLikePiPackageRoot);
}

export function getPiPackageRoot(): string {
	if (cachedRoot) return cachedRoot;

	const resolved = tryResolveFromModuleGraph()
		?? tryResolveFromBinaryPath()
		?? tryResolveFromPlatformFallbacks();

	if (resolved) {
		cachedRoot = resolved;
		return resolved;
	}

	const extensionDir = dirname(fileURLToPath(import.meta.url));
	throw new Error(
		`Unable to locate @mariozechner/pi-coding-agent from ${extensionDir}. ` +
		`Tried module resolution, the running pi binary path, and common install locations.`,
	);
}

export function getCoreExportHtmlDir(): string {
	return join(getPiPackageRoot(), "dist", "core", "export-html");
}

export function getCoreExportAssetPath(...parts: string[]): string {
	return join(getCoreExportHtmlDir(), ...parts);
}