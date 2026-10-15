/**
 * Headless verification of the provider-fold client bundle.
 *
 * Rebuilds the exact DOM the model selection menu produces for provider
 * groups (MenuGroup renders `section[data-menu-group]` with a
 * `[data-menu-group-heading]` label; the rows are
 * `button[role=menuitemradio]`), then loads the real client.js bundle under a
 * stub module loader and asserts the behaviour the user asked for.
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const BUNDLE = new URL("../client.js", import.meta.url);
const source = readFileSync(BUNDLE, "utf8");

let failures = 0;
let checks = 0;

function check(name, condition, detail = "") {
	checks++;
	if (condition) {
		console.log(`  PASS  ${name}`);
	} else {
		failures++;
		console.log(`  FAIL  ${name}${detail === "" ? "" : ` 鈥?${detail}`}`);
	}
}

/** The menu markup the model selection component renders. */
function menuMarkup(groups) {
	const sections = groups
		.map((group) => {
			const rows = group.models
				.map(
					(model, index) =>
						`<button type="button" role="menuitemradio" aria-checked="${group.selected === index}" id="menu-model-${group.offset + index}" tabindex="-1"${group.selected === index ? ' data-highlighted=""' : ""}><span class="modelName">${model}</span></button>`
				)
				.join("");
			return `<section role="group" aria-labelledby="h-${group.id}" data-menu-group=""><span aria-hidden="true" data-menu-group-start=""></span><div id="h-${group.id}" data-menu-group-heading="" class="heading">${group.label}</div>${rows}</section>`;
		})
		.join("");
	return `
	<div class="menu" role="group" aria-label="妯″瀷">
		<div class="searchRow"><input type="text" role="searchbox" placeholder="鎼滅储妯″瀷鈥? value=""></div>
		<div id="menu-models" class="groups scrollable" role="menu" aria-label="妯″瀷">${sections}</div>
	</div>`;
}

const GROUPS = [
	{ id: "deepseek-account", label: "DeepSeek 璐﹀彿", models: ["DeepSeek-V41-Flash", "DeepSeek-V4-Pro"], offset: 0, selected: 0 },
	{ id: "deepseek-official", label: "DeepSeek", models: ["DeepSeek-V41-Flash", "DeepSeek-V4-Pro"], offset: 2, selected: -1 },
	{ id: "workbuddy-ai", label: "WorkBuddy", models: ["Hy4 preview", "Hy3", "Hy3", "Step-5-Preview"], offset: 4, selected: -1 }
];

/**
 * A different menu that also uses MenuGroup sections holding radio rows. It
 * must never be decorated: the bundle is scoped to the model menu.
 */
function foreignMenuMarkup() {
	return `
	<div class="other-menu" role="group" aria-label="鍏朵粬">
		<div id="other-list" class="groups" role="listbox" aria-label="鍏朵粬">
			<section role="group" data-menu-group=""><div data-menu-group-heading="" class="heading">鍒殑鍒嗙粍</div><button type="button" role="menuitemradio">椤圭洰</button></section>
		</div>
	</div>`;
}

async function main() {
	console.log("\n=== provider-fold client bundle verification ===\n");

	const dom = new JSDOM(
		`<!doctype html><html><head></head><body>${menuMarkup(GROUPS)}${foreignMenuMarkup()}</body></html>`,
		{
			url: "http://127.0.0.1:19387/",
			pretendToBeVisual: true,
			runScripts: "outside-only"
		}
	);
	const { window } = dom;
	const { document } = window;

	// jsdom lacks these; the bundle only uses them as hooks.
	window.queueMicrotask = queueMicrotask;

	// Stub the module loader the shell installs, then evaluate the real bundle.
	let registration = null;
	window.__ModuleLoader__ = {
		load(entry) {
			registration = entry;
		}
	};
	window.eval(source);

	check("bundle registers its factory", registration !== null);
	check("registration id equals the package name", registration?.id === "dsh-provider-fold", String(registration?.id));

	const exports = registration.factory();
	check("factory returns an apply function", typeof exports.apply === "function");
	check("factory declares no module dependencies", Array.isArray(exports.inject) && exports.inject.length === 0);

	// A minimal ctx with the effect helper the bundle relies on.
	const cleanups = [];
	const ctx = {
		effect(callback) {
			const dispose = callback();
			if (typeof dispose === "function") cleanups.push(dispose);
			return dispose;
		}
	};

	exports.apply(ctx);
	await new Promise((resolve) => setTimeout(resolve, 30));

	const modelContainer = document.querySelector("#menu-models");
	const sections = [...modelContainer.querySelectorAll("section[data-menu-group]")];
	const headings = sections.map((section) => section.querySelector("[data-menu-group-heading]"));
	check("all three provider sections were decorated", sections.length === 3 && headings.every((h) => h.hasAttribute("data-pf-heading")));

	console.log("\n-- scoped to the model menu --");
	const foreign = document.querySelector("#other-list section[data-menu-group]");
	check("a different menu using the same primitives is left alone", !foreign.hasAttribute("data-pf-collapsed") && !foreign.querySelector("[data-menu-group-heading]").hasAttribute("data-pf-heading"));

	console.log("\n-- prominent provider heading --");
	check("headings are exposed as disclosure menuitems", headings.every((h) => h.getAttribute("role") === "menuitem"));
	check("headings are keyboard focusable", headings.every((h) => h.getAttribute("tabindex") === "0"));
	check("headings start expanded", headings.every((h) => h.getAttribute("aria-expanded") === "true"));
	check("no group is collapsed before any click", sections.every((s) => !s.hasAttribute("data-pf-collapsed")));

	const style = document.querySelector('style[data-plugin="dsh-provider-fold"]');
	check("a plugin-owned stylesheet was injected", style !== null);
	const css = style?.textContent ?? "";
	check("stylesheet makes the provider label prominent", /font-weight:\s*600/.test(css) && /--dsw-alias-label-primary/.test(css));
	check("stylesheet adds a disclosure chevron", /::before/.test(css) && /border-top/.test(css));
	check("stylesheet hides collapsed rows without unmounting them", /data-pf-collapsed\]\s*>\s*button\[role="menuitemradio"\]\s*\{\s*display:\s*none/.test(css.replace(/\s+/g, " ")));
	check("stylesheet only targets the model menu's groups", css.includes("section[data-menu-group]") && !/body\s*>\s*div/.test(css));

	console.log("\n-- collapse interaction --");
	const workbuddy = sections[2];
	const workbuddyHeading = headings[2];
	check("third provider is WorkBuddy", workbuddyHeading.textContent.trim() === "WorkBuddy");

	workbuddyHeading.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	await new Promise((resolve) => setTimeout(resolve, 30));

	check("clicking the heading collapses that provider", workbuddy.hasAttribute("data-pf-collapsed"));
	check("collapsed heading reports aria-expanded=false", workbuddyHeading.getAttribute("aria-expanded") === "false");
	check("collapsed heading exposes its model count", workbuddyHeading.getAttribute("data-pf-count") === "4", String(workbuddyHeading.getAttribute("data-pf-count")));
	check("collapsed rows stay in the DOM", workbuddy.querySelectorAll('button[role="menuitemradio"]').length === 4);
	check("other providers are untouched", !sections[0].hasAttribute("data-pf-collapsed") && !sections[1].hasAttribute("data-pf-collapsed"));

	console.log("\n-- persistence --");
	const stored = window.localStorage.getItem("dsh-provider-fold:collapsed");
	check("the choice is persisted", stored !== null && JSON.parse(stored).includes("WorkBuddy"), String(stored));

	console.log("\n-- keyboard interaction --");
	const deepseekHeading = headings[1];
	const keyEvent = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
	deepseekHeading.dispatchEvent(keyEvent);
	await new Promise((resolve) => setTimeout(resolve, 30));
	check("Enter toggles a focused heading", sections[1].hasAttribute("data-pf-collapsed"));

	const spaceEvent = new window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
	deepseekHeading.dispatchEvent(spaceEvent);
	await new Promise((resolve) => setTimeout(resolve, 30));
	check("Space toggles it back", !sections[1].hasAttribute("data-pf-collapsed"));
	check("the keypress does not bubble into the menu's own handler", spaceEvent.defaultPrevented);

	console.log("\n-- search force-expands --");
	const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
	const sectionOf = (heading) => heading.closest("section[data-menu-group]");
	const setCollapsed = (heading, want) => {
		if (sectionOf(heading).hasAttribute("data-pf-collapsed") !== want) {
			heading.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		}
	};

	// Establish a deterministic state: two providers collapsed.
	setCollapsed(workbuddyHeading, true);
	setCollapsed(headings[0], true);
	await tick();
	check("two providers are collapsed", sections.filter((s) => s.hasAttribute("data-pf-collapsed")).length === 2);

	const search = document.querySelector('input[role="searchbox"]');
	search.value = "Hy";
	search.dispatchEvent(new window.Event("input", { bubbles: true }));
	await tick();
	check("searching expands every group", sections.every((s) => !s.hasAttribute("data-pf-collapsed")));

	const storedAfterSearch = JSON.parse(window.localStorage.getItem("dsh-provider-fold:collapsed"));
	check("searching does not erase saved choices", storedAfterSearch.includes("WorkBuddy") && storedAfterSearch.includes("DeepSeek 璐﹀彿"), JSON.stringify(storedAfterSearch));

	search.value = "";
	search.dispatchEvent(new window.Event("input", { bubbles: true }));
	await tick();
	check("clearing the query restores the saved collapse", sections.filter((s) => s.hasAttribute("data-pf-collapsed")).length === 2);

	console.log("\n-- keyboard reveal is session-scoped --");
	// Arrow onto a row inside a collapsed provider: it must reveal, without
	// rewriting the saved preference.
	const storedBeforeReveal = window.localStorage.getItem("dsh-provider-fold:collapsed");
	const workbuddyRow = workbuddy.querySelector('button[role="menuitemradio"]');
	for (const row of document.querySelectorAll('[data-highlighted]')) row.removeAttribute("data-highlighted");
	workbuddyRow.setAttribute("data-highlighted", "");
	await tick();
	check("navigating into a collapsed provider reveals it", !workbuddy.hasAttribute("data-pf-collapsed"));
	check("the reveal writes nothing to storage", window.localStorage.getItem("dsh-provider-fold:collapsed") === storedBeforeReveal, String(window.localStorage.getItem("dsh-provider-fold:collapsed")));

	// Reopen the menu: the revealed group must be collapsed again, because the
	// reveal belonged to that presentation only.
	const host = document.querySelector("body");
	const container = document.querySelector(".menu");
	container.remove();
	await tick();
	host.insertAdjacentHTML("beforeend", menuMarkup(GROUPS));
	await tick();
	const reopened = [...document.querySelector("#menu-models").querySelectorAll("section[data-menu-group]")];
	check("reopening the menu restores the saved collapse", reopened[2].hasAttribute("data-pf-collapsed") && reopened[0].hasAttribute("data-pf-collapsed"));
	check("reopened menu keeps the untouched provider expanded", !reopened[1].hasAttribute("data-pf-collapsed"));

	console.log("\n-- teardown --");
	check("cleanup was registered", cleanups.length === 1);
	cleanups[0]();
	await new Promise((resolve) => setTimeout(resolve, 20));
	check("cleanup removes the stylesheet", document.querySelector('style[data-plugin="dsh-provider-fold"]') === null);
	check("cleanup removes collapse state", document.querySelectorAll("[data-pf-collapsed]").length === 0);
	check("cleanup removes heading decoration", document.querySelectorAll("[data-pf-heading]").length === 0);
	check("cleanup removes the disclosure role", document.querySelectorAll('[data-menu-group-heading][role="menuitem"]').length === 0);

	// The menu must survive teardown untouched.
	const restored = document.querySelector("#menu-models");
	check("the menu still has all three provider headings", restored.querySelectorAll("[data-menu-group-heading]").length === 3);
	check("the menu still has all eight model rows", restored.querySelectorAll('button[role="menuitemradio"]').length === 8);
	check("the unrelated menu was never touched", document.querySelector("#other-list").querySelectorAll('button[role="menuitemradio"]').length === 1);

	console.log(`\n=== ${checks - failures}/${checks} checks passed ===`);
	if (failures > 0) {
		console.log(`${failures} FAILED`);
		process.exitCode = 1;
	} else {
		console.log("ALL CHECKS PASSED");
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
