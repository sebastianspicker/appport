const applications = [
  {
    id: "m365",
    name: "Microsoft 365 Apps",
    publisher: "Microsoft",
    description:
      "Word, Excel, PowerPoint, and Outlook for managed workstations.",
    source: "windows_msi",
    sourceLabel: "MSI",
    releasedVersion: "2606",
    installedVersion: null,
    installState: "available",
    initials: "M",
  },
  {
    id: "vscode",
    name: "Visual Studio Code",
    publisher: "Microsoft",
    description:
      "Source editor with the organization’s approved extension policy.",
    source: "winget",
    sourceLabel: "Winget",
    releasedVersion: "1.108",
    installedVersion: "1.107",
    installState: "update_available",
    initials: "V",
  },
  {
    id: "sevenzip",
    name: "7-Zip",
    publisher: "Igor Pavlov",
    description:
      "File archiver for approved compression and extraction workflows.",
    source: "windows_exe",
    sourceLabel: "EXE",
    releasedVersion: "26.00",
    installedVersion: null,
    installState: "available",
    initials: "7",
  },
];

const state = {
  view: "available",
  query: "",
  source: "all",
  pendingAppId: null,
  simulated: new Set(),
};

const grid = document.querySelector("#app-grid");
const emptyState = document.querySelector("#empty-state");
const summary = document.querySelector("#result-summary");
const search = document.querySelector("#search");
const sourceFilter = document.querySelector("#source-filter");
const dialog = document.querySelector("#confirmation-dialog");
const dialogApp = document.querySelector("#dialog-app");
const dialogVersion = document.querySelector("#dialog-version");
const dialogDescription = document.querySelector("#dialog-description");
const confirmAction = document.querySelector("#confirm-action");

function visibleApplications() {
  const normalizedQuery = state.query.trim().toLocaleLowerCase();
  return applications.filter((application) => {
    const matchesView =
      state.view === "updates"
        ? application.installState === "update_available"
        : application.installState === "available";
    const matchesSource =
      state.source === "all" || application.source === state.source;
    const matchesQuery =
      normalizedQuery.length === 0 ||
      `${application.name} ${application.publisher} ${application.description}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    return matchesView && matchesSource && matchesQuery;
  });
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createCard(application) {
  const card = createElement("article", "card");
  const heading = createElement("div", "card-heading");
  const icon = createElement("div", "app-icon", application.initials);
  icon.setAttribute("aria-hidden", "true");
  const headingCopy = document.createElement("div");
  headingCopy.append(
    createElement("p", "eyebrow", application.publisher),
    createElement("h2", "", application.name),
  );
  heading.append(icon, headingCopy);

  const description = createElement(
    "p",
    "description",
    application.description,
  );
  const source = createElement(
    "p",
    "source",
    `Source: ${application.sourceLabel}`,
  );
  const version = createElement("div", "version-rail");
  if (application.installedVersion) {
    version.append(
      document.createTextNode(`${application.installedVersion} → `),
      createElement("strong", "", application.releasedVersion),
    );
  } else {
    version.append(
      document.createTextNode("Version "),
      createElement("strong", "", application.releasedVersion),
    );
  }

  const intent =
    application.installState === "update_available" ? "update" : "install";
  card.append(heading, description, source, version);
  if (state.simulated.has(application.id)) {
    card.append(
      createElement(
        "p",
        "simulated-result",
        `Simulation complete. No ${intent} command was sent.`,
      ),
    );
  } else {
    const button = createElement("button", "card-action", `Simulate ${intent}`);
    button.type = "button";
    button.addEventListener("click", () => openConfirmation(application));
    card.append(button);
  }
  return card;
}

function render() {
  const visible = visibleApplications();
  grid.replaceChildren(...visible.map(createCard));
  emptyState.hidden = visible.length !== 0;
  summary.textContent = `${visible.length} ${visible.length === 1 ? "application" : "applications"} · sanitized fixtures`;

  document.querySelectorAll("[data-view]").forEach((button) => {
    const selected = button.dataset.view === state.view;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
  });
}

function openConfirmation(application) {
  const intent =
    application.installState === "update_available" ? "update" : "install";
  state.pendingAppId = application.id;
  dialogApp.textContent = application.name;
  dialogVersion.textContent = application.releasedVersion;
  dialogDescription.textContent = `Review this fixture-only ${intent} simulation.`;
  confirmAction.textContent = `Confirm simulated ${intent}`;
  dialog.showModal();
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    render();
  });
});

search.addEventListener("input", () => {
  state.query = search.value;
  render();
});

sourceFilter.addEventListener("change", () => {
  state.source = sourceFilter.value;
  render();
});

dialog.addEventListener("close", () => {
  if (dialog.returnValue === "confirm" && state.pendingAppId) {
    state.simulated.add(state.pendingAppId);
    render();
  }
  state.pendingAppId = null;
});

render();
