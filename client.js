/**
 * Client half of the provider-fold bundle.
 *
 * The model selection menu renders one `MenuGroup` section per provider
 * (`section[data-menu-group]` with a `[data-menu-group-heading]` label). This
 * module turns every one of those headings into a collapsible section header
 * with a more prominent provider label, a disclosure chevron and a model count
 * while collapsed.
 *
 * The React component keeps owning the tree: this module only sets attributes
 * on the heading and the section, and hides collapsed rows through CSS. Rows
 * stay mounted so the component's highlight/selection indices keep matching.
 */

/** Collapsed provider labels, keyed by heading text and persisted per browser. */
const STORAGE_KEY = "dsh-provider-fold:collapsed";

const HEADING_SELECTOR = "[data-menu-group-heading]";
const SECTION_SELECTOR = "section[data-menu-group]";
const ROW_SELECTOR = 'button[role="menuitemradio"]';

const CSS = `
/* The provider heading becomes the section's disclosure control. */
section[data-menu-group] > ${HEADING_SELECTOR}[data-pf-heading] {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  padding: 6px 7px 4px;
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  letter-spacing: 0.01em;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: background-color var(--ds-transition-duration-fast, 0.1s) ease;
}

section[data-menu-group] > ${HEADING_SELECTOR}[data-pf-heading]:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

section[data-menu-group] > ${HEADING_SELECTOR}[data-pf-heading]:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}

/* Disclosure chevron: down when open, right when collapsed. */
section[data-menu-group] > ${HEADING_SELECTOR}[data-pf-heading]::before {
  content: "";
  flex: none;
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
  opacity: 0.55;
  transition: transform var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}

section[data-menu-group][data-pf-collapsed] > ${HEADING_SELECTOR}[data-pf-heading]::before {
  transform: rotate(-90deg);
}

/* Model count, shown only while the group is collapsed. */
section[data-menu-group] > ${HEADING_SELECTOR}[data-pf-heading]::after {
  content: none;
  margin-left: auto;
  flex: none;
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}

section[data-menu-group][data-pf-collapsed] > ${HEADING_SELECTOR}[data-pf-heading]::after {
  content: attr(data-pf-count);
}

/* Separate one provider from the next. */
section[data-menu-group] + section[data-menu-group] > ${HEADING_SELECTOR}[data-pf-heading] {
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}

/* Collapsed rows stay in the tree; only their rendering is suppressed. */
section[data-menu-group][data-pf-collapsed] > ${ROW_SELECTOR} {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  section[data-menu-group] > ${HEADING_SELECTOR}[data-pf-heading],
  section[data-menu-group] > ${HEADING_SELECTOR}[data-pf-heading]::before {
    transition: none;
  }
}
`;

window.__ModuleLoader__.load({
	id: "dsh-provider-fold",
	factory() {
		/** Provider labels the user collapsed. */
		const collapsed = new Set(readCollapsed());
		/** Labels navigation force-expanded for this menu presentation only; never persisted. */
		const revealed = new Set();
		/** Whether the current menu presentation already observed its initial highlight. */
		let sessionStarted = false;
		let sessionHighlight = null;
		let scheduled = false;

		function readCollapsed() {
			try {
				const raw = window.localStorage.getItem(STORAGE_KEY);
				const parsed = raw === null ? [] : JSON.parse(raw);
				return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
			} catch {
				return [];
			}
		}

		function persist() {
			try {
				window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed]));
			} catch {
				/* Storage being unavailable costs persistence, never the behaviour. */
			}
		}

		function labelOf(heading) {
			return (heading.textContent ?? "").trim();
		}

		/**
		 * Whether this element is the model menu's group container. The component
		 * renders `role="menu"` with an `-models` id, and a search box sits beside
		 * it whenever the list is long enough to need one.
		 */
		function isModelContainer(container) {
			if (!(container instanceof HTMLElement) || container.getAttribute("role") !== "menu") return false;
			if (container.id.endsWith("-models")) return true;
			const surface = container.parentElement;
			return surface !== null && surface.querySelector('input[role="searchbox"]') !== null;
		}

		/**
		 * The provider sections of the model menu. Only sections of that menu that
		 * actually hold model rows qualify, so no other menu is touched.
		 */
		function modelSections() {
			const found = [];
			for (const section of document.querySelectorAll(SECTION_SELECTOR)) {
				if (!(section instanceof HTMLElement)) continue;
				const container = section.parentElement;
				if (container === null || !isModelContainer(container)) continue;
				if (container.querySelector(ROW_SELECTOR) === null) continue;
				const heading = section.querySelector(`:scope > ${HEADING_SELECTOR}`);
				if (!(heading instanceof HTMLElement)) continue;
				found.push({ section, container, heading });
			}
			return found;
		}

		/** The live search text of the menu that owns this container. */
		function searchQuery(container) {
			const surface = container.parentElement;
			const input = surface === null ? null : surface.querySelector('input[role="searchbox"]');
			return input instanceof HTMLInputElement ? input.value.trim() : "";
		}

		/**
		 * Reveal the section that keyboard navigation just highlighted. The
		 * expansion is scoped to this menu presentation, so a saved choice is
		 * never consumed by merely arrowing through a collapsed provider.
		 */
		function revealActive(container, active) {
			if (active === null) return;
			const section = active.closest(SECTION_SELECTOR);
			const heading = section === null ? null : section.querySelector(`:scope > ${HEADING_SELECTOR}`);
			if (!(heading instanceof HTMLElement)) return;
			const label = labelOf(heading);
			if (label === "" || !collapsed.has(label)) return;
			revealed.add(label);
		}

		function applyState(section, heading, count, isCollapsed) {
			heading.setAttribute("data-pf-heading", "");
			/* The heading is an owned item of the surrounding role="menu", so it
			 * must be a menuitem rather than a button. */
			heading.setAttribute("role", "menuitem");
			heading.setAttribute("tabindex", "0");
			heading.setAttribute("data-pf-count", String(count));
			heading.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
			if (isCollapsed) section.setAttribute("data-pf-collapsed", "");
			else section.removeAttribute("data-pf-collapsed");
		}

		function toggle(section, heading) {
			const label = labelOf(heading);
			if (label === "") return;
			const next = !section.hasAttribute("data-pf-collapsed");
			const count = section.querySelectorAll(`:scope > ${ROW_SELECTOR}`).length;
			/* An explicit toggle is the user's decision: it replaces any navigation reveal. */
			revealed.delete(label);
			if (next) collapsed.add(label);
			else collapsed.delete(label);
			persist();
			applyState(section, heading, count, next);
		}

		function decorate() {
			const sections = modelSections();
			if (sections.length === 0) {
				sessionStarted = false;
				sessionHighlight = null;
				revealed.clear();
				return;
			}
			const container = sections[0].container;
			const searching = searchQuery(container) !== "";
			const active = container.querySelector(`${ROW_SELECTOR}[data-highlighted]`);
			const activeId = active === null ? null : active.id;
			if (!sessionStarted) {
				/* The first highlight of a presentation is the current selection, not navigation. */
				sessionStarted = true;
				sessionHighlight = activeId;
			} else if (activeId !== sessionHighlight) {
				sessionHighlight = activeId;
				/* A search result set is force-expanded, so it never triggers a reveal. */
				if (!searching) revealActive(container, active);
			}
			for (const { section, heading } of sections) {
				const label = labelOf(heading);
				const count = section.querySelectorAll(`:scope > ${ROW_SELECTOR}`).length;
				const isCollapsed = !searching && label !== "" && collapsed.has(label) && !revealed.has(label);
				applyState(section, heading, count, isCollapsed);
			}
		}

		function schedule() {
			if (scheduled) return;
			scheduled = true;
			queueMicrotask(() => {
				scheduled = false;
				decorate();
			});
		}

		function headingOf(target) {
			if (!(target instanceof Element)) return null;
			const heading = target.closest(HEADING_SELECTOR);
			return heading instanceof HTMLElement && heading.hasAttribute("data-pf-heading") ? heading : null;
		}

		function onClick(event) {
			const heading = headingOf(event.target);
			if (heading === null) return;
			const section = heading.closest(SECTION_SELECTOR);
			if (section === null) return;
			toggle(section, heading);
		}

		function onKeyDown(event) {
			if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
			const heading = headingOf(event.target);
			if (heading === null) return;
			const section = heading.closest(SECTION_SELECTOR);
			if (section === null) return;
			event.preventDefault();
			event.stopPropagation();
			toggle(section, heading);
		}

		function teardown() {
			for (const section of document.querySelectorAll(SECTION_SELECTOR)) section.removeAttribute("data-pf-collapsed");
			for (const heading of document.querySelectorAll(`${HEADING_SELECTOR}[data-pf-heading]`)) {
				heading.removeAttribute("data-pf-heading");
				heading.removeAttribute("data-pf-count");
				heading.removeAttribute("aria-expanded");
				heading.removeAttribute("role");
				heading.removeAttribute("tabindex");
			}
		}

		return {
			inject: [],
			apply(ctx) {
				ctx.effect(() => {
					const style = document.createElement("style");
					style.setAttribute("data-plugin", "dsh-provider-fold");
					style.textContent = CSS;
					document.head.append(style);

					const observer = new MutationObserver(schedule);
					observer.observe(document.body, {
						childList: true,
						subtree: true,
						attributes: true,
						attributeFilter: ["data-highlighted"]
					});
					document.addEventListener("click", onClick);
					document.addEventListener("keydown", onKeyDown);
					document.addEventListener("input", schedule, true);
					document.addEventListener("focusin", schedule, true);
					schedule();

					return () => {
						observer.disconnect();
						document.removeEventListener("click", onClick);
						document.removeEventListener("keydown", onKeyDown);
						document.removeEventListener("input", schedule, true);
						document.removeEventListener("focusin", schedule, true);
						teardown();
						style.remove();
					};
				}, "provider-fold: collapsible provider groups");
			}
		};
	}
});
