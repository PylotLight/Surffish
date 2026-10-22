// "Fields" mode of the PDF editor: draw new form fields on any page (also on PDFs with no form), and
// select / move / resize / delete / edit the ones already there. Every change is one pdf-lib op
// (src/shared/pdf-form-fields.ts) run by main.ts on the baked bytes, then the file is reopened, so
// new fields are fillable at once and Undo restores the bytes from before the op.
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { EventBus, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import {
  checkFieldName,
  DEFAULT_FIELD_SIZE,
  DEFAULT_FONT_SIZE,
  DEFAULT_OPTIONS,
  describeFields,
  normalizeOptions,
  normalizeRect,
  parseWidgetId,
  suggestFieldName,
  type DateFormat,
  type FieldChanges,
  type FieldInfo,
  type FieldKind,
  type FieldOp,
  type FieldRect,
  type NewField,
} from "../../../shared/pdf-form-fields";

interface WidgetData {
  id: string;
  annotationType: number;
  fieldName?: string;
  fieldType?: string;
  rect: number[];
  hidden?: boolean;
}

type PageView = {
  id: number;
  div: HTMLDivElement;
  pdfPage: PDFPageProxy | null;
  viewport: { rotation: number };
};

type Viewport = ReturnType<PDFPageProxy["getViewport"]>;

interface FieldToolsHost {
  viewer: PDFViewer;
  eventBus: EventBus;
  /** Current bytes (pending edits baked in), for reading field properties. */
  currentBytes(): Promise<Uint8Array>;
  /** Run ops on the document and reopen it; resolves false when the op failed (host shows why). */
  runFieldOps(ops: FieldOp[]): Promise<boolean>;
  /** Leave any pdf.js editing tool before Fields mode starts. */
  leaveEditorTool(): void;
  isBusy(): boolean;
  showMessage(text: string, kind?: "info" | "error", timeout?: number): void;
}

const WIDGET = 20;
const KIND_LABEL: Record<FieldKind | "other", string> = {
  text: "Text field",
  multiline: "Paragraph field",
  checkbox: "Checkbox",
  radio: "Radio group",
  dropdown: "Dropdown",
  date: "Date field",
  signature: "Signature field",
  other: "Field",
};
const FONT_KINDS = new Set<FieldKind | "other">([
  "text",
  "multiline",
  "date",
  "dropdown",
]);
const TEXT_DEFAULT_KINDS = new Set<FieldKind | "other">([
  "text",
  "multiline",
  "date",
]);

function defaultDateFormat(): DateFormat {
  return /^en-US\b|^en-PH\b/.test(navigator.language)
    ? "mm/dd/yyyy"
    : "dd/mm/yyyy";
}

interface FormValues {
  name: string;
  required: boolean;
  readOnly: boolean;
  fontSize: number;
  options: string[];
  defaultValue: string;
  dateFormat: string;
}

interface Draft {
  /** A field being added (not in the file yet). */
  add?: { kind: FieldKind; page: number; rect: FieldRect };
  /** An existing field being edited. */
  edit?: FieldInfo;
  box: HTMLElement;
}

export class FieldTools {
  readonly #host: FieldToolsHost;
  #document: PDFDocumentProxy | null = null;
  #active = false;
  #armed: FieldKind | null = null;
  #fields: Promise<FieldInfo[]> | null = null;
  #widgets = new Map<number, Promise<WidgetData[]>>();
  #selectedId: string | null = null;
  #selectAfterLoad: string | null = null;
  #draft: Draft | null = null;
  readonly #button = document.getElementById("fieldsMode") as HTMLButtonElement;
  readonly #kinds = document.getElementById("fieldKinds") as HTMLElement;
  readonly #popover = document.getElementById(
    "fieldPopover",
  ) as HTMLFormElement;

  constructor(host: FieldToolsHost) {
    this.#host = host;
    this.#button.addEventListener("click", () => this.setActive(!this.#active));
    for (const button of this.#kinds.querySelectorAll<HTMLButtonElement>(
      "[data-field-kind]",
    )) {
      button.addEventListener("click", () =>
        this.#arm(
          (button.dataset.fieldKind as FieldKind) === this.#armed
            ? null
            : (button.dataset.fieldKind as FieldKind),
        ),
      );
    }
    host.eventBus.on("pagerendered", ({ source }: { source: PageView }) => {
      if (this.#active) void this.#decorate(source);
    });
    host.eventBus.on(
      "annotationlayerrendered",
      ({ source }: { source: PageView }) => {
        if (this.#active) void this.#decorate(source);
      },
    );
    window.addEventListener("keydown", (event) => this.#onKeydown(event));
    this.#popover.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.#submit();
    });
    this.#popover
      .querySelector("#fieldCancel")
      ?.addEventListener("click", () => this.#closePopover());
    this.#popover
      .querySelector("#fieldDelete")
      ?.addEventListener("click", () => {
        void this.#deleteSelected();
      });
    const options =
      this.#popover.querySelector<HTMLTextAreaElement>("#fieldOptions")!;
    options.addEventListener("input", () =>
      this.#fillDefaultChoices(
        normalizeOptions(options.value.split("\n")),
        this.#input<HTMLSelectElement>("fieldDefaultChoice").value,
      ),
    );
  }

  get active(): boolean {
    return this.#active;
  }

  setDocument(document_: PDFDocumentProxy): void {
    this.#document = document_;
    this.#fields = null;
    this.#widgets.clear();
    this.#draft = null;
    this.#popover.hidden = true;
    const keep = this.#selectAfterLoad;
    this.#selectedId = null;
    this.#selectAfterLoad = keep;
    const pureXfa =
      (document_ as unknown as { isPureXfa?: boolean }).isPureXfa === true;
    this.#button.disabled = pureXfa;
    this.#button.title = pureXfa
      ? "Fields can’t be added to XFA forms"
      : "Add, move and edit form fields";
    if (pureXfa && this.#active) this.setActive(false);
  }

  setActive(active: boolean): void {
    if (active === this.#active) return;
    this.#active = active;
    if (active) this.#host.leaveEditorTool();
    document.body.classList.toggle("fields-mode", active);
    this.#button.classList.toggle("is-active", active);
    this.#button.setAttribute("aria-pressed", String(active));
    this.#kinds.hidden = !active;
    this.#closePopover();
    this.#arm(null);
    this.#selectedId = null;
    if (active) {
      for (let index = 0; index < (this.#document?.numPages ?? 0); index += 1) {
        const view = this.#host.viewer.getPageView(index) as
          PageView | undefined;
        if (view?.pdfPage) void this.#decorate(view);
      }
      this.#host.showMessage(
        "Pick a field type, then click or drag on the page. Click a field to edit it.",
        "info",
        5000,
      );
    } else {
      for (const layer of document.querySelectorAll(".fieldEditLayer"))
        layer.remove();
    }
  }

  #arm(kind: FieldKind | null): void {
    this.#armed = kind;
    document.body.dataset.fieldKind = kind ?? "";
    for (const button of this.#kinds.querySelectorAll<HTMLButtonElement>(
      "[data-field-kind]",
    )) {
      const on = button.dataset.fieldKind === kind;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-pressed", String(on));
    }
  }

  #fieldInfo(): Promise<FieldInfo[]> {
    if (!this.#fields)
      this.#fields = this.#host
        .currentBytes()
        .then(describeFields)
        .catch(() => []);
    return this.#fields;
  }

  #pageWidgets(pageIndex: number): Promise<WidgetData[]> {
    const document_ = this.#document;
    if (!document_) return Promise.resolve([]);
    let pending = this.#widgets.get(pageIndex);
    if (!pending) {
      pending = document_
        .getPage(pageIndex + 1)
        .then((page) => page.getAnnotations({ intent: "display" }))
        .then((annotations) =>
          (annotations as WidgetData[]).filter(
            (annotation) =>
              annotation.annotationType === WIDGET && !annotation.hidden,
          ),
        )
        .catch(() => []);
      this.#widgets.set(pageIndex, pending);
    }
    return pending;
  }

  #viewport(view: PageView): Viewport | null {
    return (
      view.pdfPage?.getViewport({
        scale: 1,
        rotation: view.viewport.rotation,
      }) ?? null
    );
  }

  // --- Overlay ----------------------------------------------------------------------------------

  async #decorate(view: PageView): Promise<void> {
    const pageIndex = view.id - 1;
    const widgets = await this.#pageWidgets(pageIndex);
    const viewport = this.#viewport(view);
    if (!this.#active || !viewport || !view.div.isConnected) return;
    let layer = view.div.querySelector<HTMLDivElement>(
      ":scope > .fieldEditLayer",
    );
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "fieldEditLayer";
      layer.dataset.pageIndex = String(pageIndex);
      layer.addEventListener("pointerdown", (event) =>
        this.#onPointerDown(event, view),
      );
      view.div.append(layer);
    }
    for (const old of layer.querySelectorAll(".fieldBox:not(.is-draft)"))
      old.remove();
    for (const widget of widgets) {
      if (!widget.rect || widget.rect.length !== 4) continue;
      const box = document.createElement("div");
      box.className = "fieldBox";
      box.dataset.widgetId = widget.id;
      box.dataset.fieldName = widget.fieldName ?? "";
      box.dataset.fieldType = widget.fieldType ?? "";
      box.title = widget.fieldName ?? "Field";
      const label = document.createElement("span");
      label.className = "fieldLabel";
      label.textContent = widget.fieldName ?? "";
      box.append(label);
      for (const corner of ["nw", "ne", "sw", "se"]) {
        const handle = document.createElement("span");
        handle.className = `fieldHandle ${corner}`;
        handle.dataset.corner = corner;
        box.append(handle);
      }
      this.#place(box, viewport, widget.rect as FieldRect);
      layer.append(box);
    }
    if (this.#selectAfterLoad) {
      const box = [...layer.querySelectorAll<HTMLElement>(".fieldBox")].find(
        (candidate) => candidate.dataset.fieldName === this.#selectAfterLoad,
      );
      if (box) {
        this.#selectAfterLoad = null;
        this.#select(box);
      }
    } else if (this.#selectedId) {
      const box = layer.querySelector<HTMLElement>(
        `.fieldBox[data-widget-id="${CSS.escape(this.#selectedId)}"]`,
      );
      box?.classList.add("is-selected");
    }
  }

  #place(box: HTMLElement, viewport: Viewport, rect: FieldRect): void {
    const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]) as [
      number,
      number,
    ];
    const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]) as [
      number,
      number,
    ];
    box.style.left = `${(Math.min(x1, x2) / viewport.width) * 100}%`;
    box.style.top = `${(Math.min(y1, y2) / viewport.height) * 100}%`;
    box.style.width = `${(Math.abs(x2 - x1) / viewport.width) * 100}%`;
    box.style.height = `${(Math.abs(y2 - y1) / viewport.height) * 100}%`;
  }

  /** The box's current rect in PDF space (after a drag), from its percentage geometry. */
  #rectOf(box: HTMLElement, viewport: Viewport): FieldRect {
    const left = (parseFloat(box.style.left) / 100) * viewport.width;
    const top = (parseFloat(box.style.top) / 100) * viewport.height;
    const width = (parseFloat(box.style.width) / 100) * viewport.width;
    const height = (parseFloat(box.style.height) / 100) * viewport.height;
    const [ax, ay] = viewport.convertToPdfPoint(left, top) as [number, number];
    const [bx, by] = viewport.convertToPdfPoint(left + width, top + height) as [
      number,
      number,
    ];
    return normalizeRect([ax, ay, bx, by]).map(
      (value) => Math.round(value * 100) / 100,
    ) as FieldRect;
  }

  #select(box: HTMLElement | null): void {
    for (const other of document.querySelectorAll(".fieldBox.is-selected"))
      other.classList.remove("is-selected");
    this.#selectedId = box?.dataset.widgetId ?? null;
    box?.classList.add("is-selected");
  }

  // --- Pointer: draw / move / resize -------------------------------------------------------------

  #onPointerDown(event: PointerEvent, view: PageView): void {
    if (event.button !== 0 || this.#host.isBusy()) return;
    const layer = event.currentTarget as HTMLDivElement;
    const viewport = this.#viewport(view);
    if (!viewport) return;
    const target = event.target as HTMLElement;
    const box = target.closest<HTMLElement>(".fieldBox:not(.is-draft)");
    event.preventDefault();
    const bounds = layer.getBoundingClientRect();
    const toPercent = (clientX: number, clientY: number): [number, number] => [
      Math.min(
        100,
        Math.max(0, ((clientX - bounds.left) / bounds.width) * 100),
      ),
      Math.min(
        100,
        Math.max(0, ((clientY - bounds.top) / bounds.height) * 100),
      ),
    ];
    const [startX, startY] = toPercent(event.clientX, event.clientY);
    layer.setPointerCapture(event.pointerId);

    if (box) {
      this.#closePopover();
      this.#select(box);
      const corner = target.dataset.corner;
      const start = {
        left: parseFloat(box.style.left),
        top: parseFloat(box.style.top),
        width: parseFloat(box.style.width),
        height: parseFloat(box.style.height),
      };
      let moved = false;
      const move = (next: PointerEvent): void => {
        const [x, y] = toPercent(next.clientX, next.clientY);
        const dx = x - startX;
        const dy = y - startY;
        if (
          !moved &&
          Math.hypot((dx / 100) * bounds.width, (dy / 100) * bounds.height) < 3
        )
          return;
        moved = true;
        if (!corner) {
          box.style.left = `${Math.min(100 - start.width, Math.max(0, start.left + dx))}%`;
          box.style.top = `${Math.min(100 - start.height, Math.max(0, start.top + dy))}%`;
          return;
        }
        let { left, top, width, height } = start;
        if (corner.includes("w")) {
          left = Math.min(start.left + start.width - 0.5, start.left + dx);
          width = start.left + start.width - left;
        }
        if (corner.includes("e")) width = Math.max(0.5, start.width + dx);
        if (corner.includes("n")) {
          top = Math.min(start.top + start.height - 0.5, start.top + dy);
          height = start.top + start.height - top;
        }
        if (corner.includes("s")) height = Math.max(0.5, start.height + dy);
        Object.assign(box.style, {
          left: `${left}%`,
          top: `${top}%`,
          width: `${width}%`,
          height: `${height}%`,
        });
      };
      const up = (): void => {
        layer.removeEventListener("pointermove", move);
        layer.removeEventListener("pointerup", up);
        layer.removeEventListener("pointercancel", up);
        const widget = parseWidgetId(box.dataset.widgetId ?? "");
        if (!moved) {
          void this.#openEdit(box);
          return;
        }
        if (!widget) {
          Object.assign(box.style, {
            left: `${start.left}%`,
            top: `${start.top}%`,
            width: `${start.width}%`,
            height: `${start.height}%`,
          });
          this.#host.showMessage("This field can’t be moved.", "error");
          return;
        }
        this.#selectAfterLoad = box.dataset.fieldName || null;
        void this.#host.runFieldOps([
          { type: "move", widget, rect: this.#rectOf(box, viewport) },
        ]);
      };
      layer.addEventListener("pointermove", move);
      layer.addEventListener("pointerup", up);
      layer.addEventListener("pointercancel", up);
      return;
    }

    this.#select(null);
    this.#closePopover();
    const kind = this.#armed;
    if (!kind) return;
    const ghost = document.createElement("div");
    ghost.className = "fieldBox is-draft";
    ghost.style.left = `${startX}%`;
    ghost.style.top = `${startY}%`;
    layer.append(ghost);
    let dragged = false;
    const move = (next: PointerEvent): void => {
      const [x, y] = toPercent(next.clientX, next.clientY);
      if (
        !dragged &&
        Math.hypot(
          ((x - startX) / 100) * bounds.width,
          ((y - startY) / 100) * bounds.height,
        ) < 4
      )
        return;
      dragged = true;
      Object.assign(ghost.style, {
        left: `${Math.min(x, startX)}%`,
        top: `${Math.min(y, startY)}%`,
        width: `${Math.abs(x - startX)}%`,
        height: `${Math.abs(y - startY)}%`,
      });
    };
    const up = (): void => {
      layer.removeEventListener("pointermove", move);
      layer.removeEventListener("pointerup", up);
      layer.removeEventListener("pointercancel", up);
      let rect: FieldRect;
      if (dragged) rect = this.#rectOf(ghost, viewport);
      else {
        // A click: the default size for the kind, top-left corner at the click.
        const [w, h] = DEFAULT_FIELD_SIZE[kind];
        const [px, py] = viewport.convertToPdfPoint(
          (startX / 100) * viewport.width,
          (startY / 100) * viewport.height,
        ) as [number, number];
        const sideways = view.viewport.rotation % 180 !== 0;
        const [pw, ph] = sideways ? [h, w] : [w, h];
        rect = normalizeRect([px, py, px + pw, py - ph]);
        this.#place(ghost, viewport, rect);
      }
      void this.#openAdd(kind, view.id - 1, rect, ghost);
    };
    layer.addEventListener("pointermove", move);
    layer.addEventListener("pointerup", up);
    layer.addEventListener("pointercancel", up);
  }

  // --- Properties popover ------------------------------------------------------------------------

  #input<T extends HTMLElement = HTMLInputElement>(id: string): T {
    return this.#popover.querySelector<T>(`#${id}`)!;
  }

  #fillDefaultChoices(options: string[], selected: string): void {
    const select = this.#input<HTMLSelectElement>("fieldDefaultChoice");
    select.textContent = "";
    for (const value of ["", ...options]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value || "None";
      option.selected = value === selected;
      select.append(option);
    }
  }

  #showPopover(
    kind: FieldKind | "other",
    values: {
      name: string;
      required: boolean;
      readOnly: boolean;
      defaultValue: string;
      fontSize?: number;
      options?: string[];
      dateFormat?: DateFormat;
    },
    editing: boolean,
    anchor: HTMLElement,
  ): void {
    const popover = this.#popover;
    popover.dataset.kind = kind;
    popover.dataset.mode = editing ? "edit" : "add";
    this.#input("fieldPopoverTitle").textContent =
      `${editing ? "Edit" : "New"} ${KIND_LABEL[kind].toLowerCase()}`;
    this.#input("fieldName").value = values.name;
    this.#input("fieldRequired").checked = values.required;
    this.#input("fieldReadOnly").checked = values.readOnly;
    const showFont = FONT_KINDS.has(kind);
    this.#input("fieldFontRow").hidden = !showFont;
    this.#input("fieldFontSize").value = String(
      values.fontSize ?? DEFAULT_FONT_SIZE,
    );
    const choices = kind === "radio" || kind === "dropdown";
    this.#input("fieldOptionsRow").hidden = !choices;
    const optionsInput = this.#input<HTMLTextAreaElement>("fieldOptions");
    optionsInput.value = (values.options ?? []).join("\n");
    // A radio group's buttons are placed with it; changing their number means a new group.
    optionsInput.readOnly = editing && kind === "radio";
    this.#input("fieldOptionsHint").hidden = !(editing && kind === "radio");
    this.#input("fieldDefaultTextRow").hidden = !TEXT_DEFAULT_KINDS.has(kind);
    this.#input("fieldDefaultText").value = TEXT_DEFAULT_KINDS.has(kind)
      ? values.defaultValue
      : "";
    this.#input("fieldDefaultText").placeholder =
      kind === "date" ? (values.dateFormat ?? defaultDateFormat()) : "";
    this.#input("fieldDefaultCheckRow").hidden = kind !== "checkbox";
    this.#input("fieldDefaultCheck").checked =
      kind === "checkbox" && values.defaultValue === "on";
    this.#input("fieldDefaultChoiceRow").hidden = !choices;
    this.#fillDefaultChoices(
      values.options ?? [],
      choices ? values.defaultValue : "",
    );
    this.#input("fieldDateRow").hidden = kind !== "date";
    const dateSelect = this.#input<HTMLSelectElement>("fieldDateFormat");
    dateSelect.value =
      values.dateFormat ?? (editing ? "" : defaultDateFormat());
    this.#input("fieldRequiredRow").hidden = false;
    this.#input("fieldDelete").hidden = !editing;
    this.#input("fieldSubmit").textContent = editing ? "Apply" : "Add";
    this.#input("fieldError").hidden = true;
    // Remember the starting values: Apply only sends what changed.
    popover.dataset.initial = JSON.stringify(this.#readForm());
    popover.hidden = false;
    const box = anchor.getBoundingClientRect();
    const own = popover.getBoundingClientRect();
    const below = box.bottom + 8 + own.height < window.innerHeight;
    popover.style.left = `${Math.max(8, Math.min(window.innerWidth - own.width - 8, box.left))}px`;
    popover.style.top = `${Math.max(56, below ? box.bottom + 8 : box.top - own.height - 8)}px`;
    const name = this.#input("fieldName");
    name.focus();
    name.select();
  }

  #readForm(): FormValues {
    const kind = this.#popover.dataset.kind as FieldKind | "other";
    let defaultValue = "";
    if (TEXT_DEFAULT_KINDS.has(kind))
      defaultValue = this.#input("fieldDefaultText").value;
    else if (kind === "checkbox")
      defaultValue = this.#input("fieldDefaultCheck").checked ? "on" : "";
    else if (kind === "radio" || kind === "dropdown")
      defaultValue = this.#input<HTMLSelectElement>("fieldDefaultChoice").value;
    return {
      name: this.#input("fieldName").value.trim(),
      required: this.#input("fieldRequired").checked,
      readOnly: this.#input("fieldReadOnly").checked,
      fontSize: Number(this.#input("fieldFontSize").value),
      options: normalizeOptions(
        this.#input<HTMLTextAreaElement>("fieldOptions").value.split("\n"),
      ),
      defaultValue,
      dateFormat: this.#input<HTMLSelectElement>("fieldDateFormat").value,
    };
  }

  async #openAdd(
    kind: FieldKind,
    page: number,
    rect: FieldRect,
    ghost: HTMLElement,
  ): Promise<void> {
    const fields = await this.#fieldInfo();
    this.#draft = { add: { kind, page, rect }, box: ghost };
    this.#showPopover(
      kind,
      {
        name: suggestFieldName(
          kind,
          fields.map((field) => field.name),
        ),
        required: false,
        readOnly: false,
        defaultValue: "",
        options: DEFAULT_OPTIONS[kind],
        dateFormat: kind === "date" ? defaultDateFormat() : undefined,
      },
      false,
      ghost,
    );
  }

  async #openEdit(box: HTMLElement): Promise<void> {
    const name = box.dataset.fieldName ?? "";
    const fields = await this.#fieldInfo();
    const info = fields.find((field) => field.name === name);
    if (!info) {
      this.#host.showMessage(
        "This field can’t be edited here (it may be part of an unsupported form).",
        "error",
      );
      return;
    }
    this.#draft = { edit: info, box };
    this.#showPopover(info.kind, info, true, box);
  }

  #closePopover(): void {
    const draft = this.#draft;
    this.#draft = null;
    this.#popover.hidden = true;
    if (draft?.add) draft.box.remove();
  }

  #error(text: string): void {
    const error = this.#input("fieldError");
    error.textContent = text;
    error.hidden = false;
  }

  async #submit(): Promise<void> {
    const draft = this.#draft;
    if (!draft || this.#host.isBusy()) return;
    const values = this.#readForm();
    const names = (await this.#fieldInfo()).map((field) => field.name);
    const kind = (draft.add?.kind ?? draft.edit?.kind) as FieldKind | "other";
    const nameProblem = checkFieldName(values.name, names, draft.edit?.name);
    if (nameProblem) return this.#error(nameProblem);
    if (
      FONT_KINDS.has(kind) &&
      !(values.fontSize >= 4 && values.fontSize <= 72)
    )
      return this.#error("Font size must be between 4 and 72.");
    if (kind === "radio" && values.options.length < 2)
      return this.#error("A radio group needs at least two choices.");
    if (kind === "dropdown" && values.options.length < 1)
      return this.#error("A dropdown needs at least one option.");
    let op: FieldOp;
    if (draft.add) {
      const field: NewField = {
        kind: draft.add.kind,
        name: values.name,
        page: draft.add.page,
        rect: draft.add.rect,
        required: values.required,
        readOnly: values.readOnly,
      };
      if (FONT_KINDS.has(kind)) field.fontSize = values.fontSize;
      if (kind === "radio" || kind === "dropdown")
        field.options = values.options;
      if (values.defaultValue) field.defaultValue = values.defaultValue;
      if (kind === "date")
        field.dateFormat = (values.dateFormat ||
          defaultDateFormat()) as DateFormat;
      op = { type: "add", field };
    } else {
      const initial = JSON.parse(
        this.#popover.dataset.initial ?? "{}",
      ) as FormValues;
      const changes: FieldChanges = {};
      if (values.name !== initial.name) changes.name = values.name;
      if (values.required !== initial.required)
        changes.required = values.required;
      if (values.readOnly !== initial.readOnly)
        changes.readOnly = values.readOnly;
      if (FONT_KINDS.has(kind) && values.fontSize !== initial.fontSize)
        changes.fontSize = values.fontSize;
      if (
        kind === "dropdown" &&
        values.options.join("\n") !== initial.options.join("\n")
      )
        changes.options = values.options;
      if (values.defaultValue !== initial.defaultValue)
        changes.defaultValue = values.defaultValue;
      if (
        kind === "date" &&
        values.dateFormat &&
        values.dateFormat !== initial.dateFormat
      )
        changes.dateFormat = values.dateFormat as DateFormat;
      if (Object.keys(changes).length === 0) {
        this.#closePopover();
        return;
      }
      op = { type: "update", name: draft.edit!.name, changes };
    }
    this.#selectAfterLoad = values.name;
    const ok = await this.#host.runFieldOps([op]);
    if (ok) {
      if (draft.add) this.#arm(null);
      this.#draft = null;
      this.#popover.hidden = true;
    } else this.#selectAfterLoad = null;
  }

  async #deleteSelected(): Promise<void> {
    const id = this.#selectedId;
    const widget = id ? parseWidgetId(id) : null;
    if (!widget || this.#host.isBusy()) return;
    this.#draft = null;
    this.#popover.hidden = true;
    this.#selectedId = null;
    await this.#host.runFieldOps([{ type: "delete", widget }]);
  }

  #onKeydown(event: KeyboardEvent): void {
    if (!this.#active) return;
    const target = event.target as HTMLElement | null;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable;
    if (event.key === "Escape") {
      if (!this.#popover.hidden) this.#closePopover();
      else if (this.#armed) this.#arm(null);
      else if (this.#selectedId) this.#select(null);
      else this.setActive(false);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (typing) return;
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      this.#selectedId
    ) {
      event.preventDefault();
      void this.#deleteSelected();
    }
  }
}
