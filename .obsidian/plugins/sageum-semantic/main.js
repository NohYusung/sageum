const {
  ItemView,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  requestUrl,
} = require("obsidian");

const SAGEUM_SEMANTIC_VIEW_TYPE = "sageum-semantic-view";

const DEFAULT_SETTINGS = {
  backendUrl: "http://127.0.0.1:4000",
  conceptRoot: "20_Concepts",
  relationSidecar: ".sageum/relations/manual_relations.json",
};

function cleanTitle(text) {
  return (text || "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return {};
  const end = text.indexOf("\n---", 4);
  if (end < 0) return {};
  const frontmatter = {};
  for (const line of text.slice(4, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (match) frontmatter[match[1]] = match[2].replace(/^"|"$/g, "");
  }
  return frontmatter;
}

function extractWikilinks(text) {
  const links = [];
  const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let match;
  while ((match = pattern.exec(text))) {
    links.push({ target: match[1].trim(), label: (match[2] || match[1]).trim() });
  }
  return links;
}

function relationId(source, type, target) {
  return `rel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${cleanTitle(source + type + target).slice(0, 16)}`;
}

async function ensureFolder(app, folderPath) {
  const parts = folderPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

class RelationModal extends Modal {
  constructor(app, evidence, onSubmit) {
    super(app);
    this.evidence = evidence;
    this.onSubmit = onSubmit;
    this.values = {
      source: "",
      relationType: "related_to",
      target: "",
    };
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Create Sageum relation" });
    contentEl.createEl("p", { text: this.evidence, cls: "sageum-modal-evidence" });

    new Setting(contentEl)
      .setName("Source concept id or title")
      .addText((input) => input.onChange((value) => (this.values.source = value.trim())));
    new Setting(contentEl)
      .setName("Relation type")
      .addText((input) => {
        input.setValue(this.values.relationType);
        input.onChange((value) => (this.values.relationType = value.trim() || "related_to"));
      });
    new Setting(contentEl)
      .setName("Target concept id or title")
      .addText((input) => input.onChange((value) => (this.values.target = value.trim())));
    new Setting(contentEl).addButton((button) => {
      button.setButtonText("Save relation").setCta().onClick(async () => {
        await this.onSubmit(this.values);
        this.close();
      });
    });
  }
}

class SageumSemanticView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return SAGEUM_SEMANTIC_VIEW_TYPE;
  }

  getDisplayText() {
    return "Sageum Semantic";
  }

  getIcon() {
    return "network";
  }

  async onOpen() {
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.render()));
    await this.render();
  }

  async render() {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("sageum-semantic-view");
    root.createEl("h3", { text: "Sageum Semantic" });

    const activeFile = this.app.workspace.getActiveFile();
    const indexFile = this.app.vault.getAbstractFileByPath(".sageum/index.sqlite");
    root.createEl("div", {
      text: indexFile ? ".sageum/index.sqlite detected" : ".sageum/index.sqlite not found; run backend index sync",
      cls: "sageum-index-state",
    });

    if (!activeFile || !(activeFile instanceof TFile) || activeFile.extension !== "md") {
      root.createEl("p", { text: "Open a Markdown note to inspect concepts and relations." });
      return;
    }

    const text = await this.app.vault.read(activeFile);
    const frontmatter = parseFrontmatter(text);
    const concepts = extractWikilinks(text);
    root.createEl("h4", { text: activeFile.path });

    const conceptList = root.createEl("div", { cls: "sageum-concept-list" });
    conceptList.createEl("strong", { text: `Concept mentions (${concepts.length})` });
    if (!concepts.length) {
      conceptList.createEl("p", { text: "No wikilinks found in the current note." });
    }
    for (const concept of concepts.slice(0, 20)) {
      conceptList.createEl("span", { text: concept.label });
    }

    const relations = await this.plugin.relationsForDocument(frontmatter.sageum_id, activeFile.path);
    const relationList = root.createEl("div", { cls: "sageum-relation-list" });
    relationList.createEl("strong", { text: `Relations (${relations.length})` });
    if (!relations.length) {
      relationList.createEl("p", { text: "No sidecar relations found for this note." });
    }
    for (const relation of relations.slice(0, 20)) {
      const row = relationList.createEl("div", { cls: "sageum-relation-row" });
      row.createEl("b", {
        text: `${relation.source_concept_id || relation.source} ${relation.relation_type} ${relation.target_concept_id || relation.target}`,
      });
      row.createEl("span", { text: relation.status || "candidate" });
      if (relation.evidence_text) row.createEl("p", { text: relation.evidence_text });
    }

    const actions = root.createEl("div", { cls: "sageum-actions" });
    actions.createEl("button", { text: "Refresh backend index" }).addEventListener("click", () => this.plugin.refreshBackendIndex());
  }
}

class SageumSemanticSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Sageum Semantic" });
    new Setting(containerEl)
      .setName("Backend URL")
      .setDesc("Sageum backend used for /vault/index and /vault/search.")
      .addText((text) => {
        text.setValue(this.plugin.settings.backendUrl);
        text.onChange(async (value) => {
          this.plugin.settings.backendUrl = value.trim() || DEFAULT_SETTINGS.backendUrl;
          await this.plugin.saveSettings();
        });
      });
    new Setting(containerEl)
      .setName("Concept root")
      .addText((text) => {
        text.setValue(this.plugin.settings.conceptRoot);
        text.onChange(async (value) => {
          this.plugin.settings.conceptRoot = cleanTitle(value) || DEFAULT_SETTINGS.conceptRoot;
          await this.plugin.saveSettings();
        });
      });
  }
}

module.exports = class SageumSemanticPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(SAGEUM_SEMANTIC_VIEW_TYPE, (leaf) => new SageumSemanticView(leaf, this));
    this.addRibbonIcon("network", "Sageum Semantic", () => this.activateView());
    this.addCommand({
      id: "open-sageum-semantic-sidebar",
      name: "Open Sageum semantic sidebar",
      callback: () => this.activateView(),
    });
    this.addCommand({
      id: "refresh-sageum-vault-index",
      name: "Refresh Sageum backend vault index",
      callback: () => this.refreshBackendIndex(),
    });
    this.addCommand({
      id: "create-sageum-concept-from-selection",
      name: "Create Sageum concept from selection",
      callback: () => this.createConceptFromSelection(),
    });
    this.addCommand({
      id: "create-sageum-relation-from-selection",
      name: "Create Sageum relation evidence from selection",
      callback: () => this.createRelationFromSelection(),
    });
    this.addSettingTab(new SageumSemanticSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(SAGEUM_SEMANTIC_VIEW_TYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView() {
    const leaf = this.app.workspace.getRightLeaf(false);
    await leaf.setViewState({ type: SAGEUM_SEMANTIC_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  selectionText() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.editor?.getSelection()?.trim() || "";
  }

  async createConceptFromSelection() {
    const selected = this.selectionText();
    const title = cleanTitle(selected);
    if (!title) {
      new Notice("Select text before creating a Sageum concept.");
      return;
    }
    await ensureFolder(this.app, this.settings.conceptRoot);
    const path = `${this.settings.conceptRoot}/${title}.md`;
    if (this.app.vault.getAbstractFileByPath(path)) {
      new Notice(`Concept already exists: ${path}`);
      return;
    }
    const now = new Date().toISOString();
    const markdown = [
      "---",
      `sageum_id: concept_${Date.now().toString(36)}`,
      "type: concept",
      "status: active",
      "created_by: obsidian-plugin",
      "aliases:",
      "  []",
      "tags:",
      "  - sageum/concept",
      "---",
      "",
      `# ${title}`,
      "",
      `Created from selection at ${now}.`,
      "",
    ].join("\n");
    await this.app.vault.create(path, markdown);
    await this.refreshBackendIndex();
    new Notice(`Created concept: ${path}`);
  }

  async createRelationFromSelection() {
    const evidence = this.selectionText();
    if (!evidence) {
      new Notice("Select evidence text before creating a Sageum relation.");
      return;
    }
    new RelationModal(this.app, evidence, async (values) => {
      if (!values.source || !values.target) {
        new Notice("Source and target are required.");
        return;
      }
      await this.appendManualRelation(values, evidence);
      await this.refreshBackendIndex();
      new Notice("Saved Sageum relation evidence.");
    }).open();
  }

  async appendManualRelation(values, evidence) {
    const activeFile = this.app.workspace.getActiveFile();
    const activeText = activeFile ? await this.app.vault.read(activeFile) : "";
    const frontmatter = parseFrontmatter(activeText);
    const relationPath = this.settings.relationSidecar;
    await ensureFolder(this.app, relationPath.split("/").slice(0, -1).join("/"));
    const existing = this.app.vault.getAbstractFileByPath(relationPath);
    const payload = existing
      ? JSON.parse(await this.app.vault.read(existing))
      : { document_id: frontmatter.sageum_id || "", relations: [] };
    payload.document_id = payload.document_id || frontmatter.sageum_id || "";
    payload.relations = Array.isArray(payload.relations) ? payload.relations : [];
    payload.relations.push({
      relation_id: relationId(values.source, values.relationType, values.target),
      source_concept_id: values.source,
      relation_type: values.relationType,
      target_concept_id: values.target,
      evidence_document_id: frontmatter.sageum_id || "",
      evidence_text: evidence,
      confidence: 1,
      status: "candidate",
      created_by: "obsidian-plugin",
      created_at: new Date().toISOString(),
    });
    const serialized = `${JSON.stringify(payload, null, 2)}\n`;
    if (existing) await this.app.vault.modify(existing, serialized);
    else await this.app.vault.create(relationPath, serialized);
  }

  async relationsForDocument(documentId, path) {
    const files = this.app.vault
      .getFiles()
      .filter((file) => file.path.startsWith(".sageum/relations/") && file.extension === "json");
    const relations = [];
    for (const file of files) {
      try {
        const payload = JSON.parse(await this.app.vault.read(file));
        if (payload.document_id && documentId && payload.document_id !== documentId) continue;
        if (payload.file && payload.file !== path) continue;
        for (const relation of payload.relations || []) relations.push(relation);
      } catch (error) {
        console.warn("Failed to read Sageum relation sidecar", file.path, error);
      }
    }
    return relations;
  }

  async refreshBackendIndex() {
    try {
      const response = await requestUrl({
        url: `${this.settings.backendUrl.replace(/\/$/, "")}/vault/index`,
        method: "POST",
        contentType: "application/json",
      });
      new Notice(`Sageum index refreshed: ${response.status}`);
    } catch (error) {
      new Notice(`Sageum backend unavailable: ${error.message || error}`);
    }
  }
};
