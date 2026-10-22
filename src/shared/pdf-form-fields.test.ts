import assert from "node:assert/strict";
import test from "node:test";
import {
  degrees,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRadioGroup,
  PDFSignature,
  PDFString,
  PDFTextField,
  StandardFonts,
} from "pdf-lib";
import {
  applyFieldOps,
  checkFieldName,
  checkNewField,
  describeFields,
  FieldOpError,
  normalizeOptions,
  parseWidgetId,
  radioButtonRects,
  suggestFieldName,
  type NewField,
} from "./pdf-form-fields.ts";

async function plainPdf(rotation = 0): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([400, 600]);
  page.drawText("Name: ________", { x: 40, y: 540, size: 12, font });
  if (rotation) page.setRotation(degrees(rotation));
  document.addPage([400, 600]);
  return document.save();
}

const all: NewField[] = [
  {
    kind: "text",
    name: "name",
    page: 0,
    rect: [40, 500, 240, 520],
    required: true,
    defaultValue: "Ada",
    fontSize: 11,
  },
  { kind: "multiline", name: "notes", page: 0, rect: [40, 420, 300, 480] },
  {
    kind: "checkbox",
    name: "agree",
    page: 0,
    rect: [40, 380, 54, 394],
    defaultValue: "on",
  },
  {
    kind: "radio",
    name: "size",
    page: 0,
    rect: [40, 340, 160, 354],
    options: ["S", "M", "L"],
    defaultValue: "M",
  },
  {
    kind: "dropdown",
    name: "country",
    page: 0,
    rect: [40, 300, 200, 320],
    options: ["Australia", "Japan"],
    defaultValue: "Japan",
    readOnly: true,
  },
  {
    kind: "date",
    name: "when",
    page: 1,
    rect: [40, 500, 140, 520],
    dateFormat: "yyyy-mm-dd",
  },
  {
    kind: "signature",
    name: "signer",
    page: 1,
    rect: [40, 400, 220, 444],
    required: true,
  },
];

function rectOf(dict: PDFDict): number[] {
  return (
    dict.lookup(PDFName.of("Rect")) as unknown as { asArray(): PDFNumber[] }
  )
    .asArray()
    .map((n) => Math.round(n.asNumber()));
}

test("field names: suggestions skip taken names and checks catch clashes", () => {
  assert.equal(suggestFieldName("text", []), "Text1");
  assert.equal(suggestFieldName("text", ["Text1", "Text2"]), "Text3");
  assert.equal(suggestFieldName("checkbox", ["Check1.sub"]), "Check2");
  assert.equal(checkFieldName("", []), "Give the field a name.");
  assert.match(checkFieldName("name", ["name"]) ?? "", /already exists/);
  assert.match(checkFieldName("a", ["a.b"]) ?? "", /clashes/);
  assert.match(checkFieldName("a.b", ["a"]) ?? "", /clashes/);
  assert.match(checkFieldName("a.", []) ?? "", /dot/);
  assert.equal(checkFieldName("name", ["name"], "name"), null);
  assert.deepEqual(normalizeOptions([" a ", "", "b", "a"]), ["a", "b"]);
  assert.deepEqual(parseWidgetId("12R"), { num: 12, gen: 0 });
  assert.deepEqual(parseWidgetId("7R2"), { num: 7, gen: 2 });
  assert.equal(parseWidgetId("pdfjs_internal_id_3"), null);
});

test("new field checks", () => {
  const base: NewField = {
    kind: "text",
    name: "x",
    page: 0,
    rect: [0, 0, 100, 20],
  };
  assert.equal(checkNewField(base, [], 1), null);
  assert.match(checkNewField({ ...base, page: 2 }, [], 1) ?? "", /page/);
  assert.match(
    checkNewField({ ...base, rect: [0, 0, 2, 2] }, [], 1) ?? "",
    /small/,
  );
  assert.match(
    checkNewField({ ...base, fontSize: 0 }, [], 1) ?? "",
    /Font size/,
  );
  assert.match(
    checkNewField({ ...base, kind: "radio", options: ["one"] }, [], 1) ?? "",
    /two choices/,
  );
  assert.match(
    checkNewField(
      { ...base, kind: "dropdown", options: ["a"], defaultValue: "b" },
      [],
      1,
    ) ?? "",
    /default/,
  );
});

test("radio buttons are laid out inside the drawn rect", () => {
  const row = radioButtonRects([0, 0, 90, 14], 3);
  assert.equal(row.length, 3);
  assert.ok(
    row.every(
      ([x1, y1, x2, y2]) =>
        x1 >= 0 && x2 <= 90 && y1 >= 0 && y2 <= 14 && x2 - x1 === y2 - y1,
    ),
  );
  assert.ok(row[0]![0] < row[1]![0] && row[1]![0] < row[2]![0]);
  const column = radioButtonRects([0, 0, 14, 90], 3);
  assert.ok(column[0]![1] > column[1]![1]);
});

test("every field type is created on a plain PDF", async () => {
  const bytes = await applyFieldOps(
    await plainPdf(),
    all.map((field) => ({ type: "add", field })),
  );
  const document = await PDFDocument.load(bytes);
  const form = document.getForm();
  assert.deepEqual(
    form
      .getFields()
      .map((field) => field.getName())
      .sort(),
    ["agree", "country", "name", "notes", "signer", "size", "when"],
  );
  const info = new Map(
    (await describeFields(bytes)).map((field) => [field.name, field]),
  );
  assert.deepEqual(info.get("name"), {
    name: "name",
    kind: "text",
    required: true,
    readOnly: false,
    defaultValue: "Ada",
    fontSize: 11,
  });
  assert.equal(info.get("notes")?.kind, "multiline");
  assert.equal(info.get("agree")?.defaultValue, "on");
  assert.deepEqual(
    [
      info.get("size")?.kind,
      info.get("size")?.options,
      info.get("size")?.defaultValue,
    ],
    ["radio", ["S", "M", "L"], "M"],
  );
  assert.deepEqual(
    [info.get("country")?.defaultValue, info.get("country")?.readOnly],
    ["Japan", true],
  );
  assert.deepEqual(
    [info.get("when")?.kind, info.get("when")?.dateFormat],
    ["date", "yyyy-mm-dd"],
  );
  assert.deepEqual(
    [info.get("signer")?.kind, info.get("signer")?.required],
    ["signature", true],
  );
  const name = form.getTextField("name");
  assert.equal(name.getText(), "Ada");
  assert.ok(name.isRequired());
  assert.match(name.acroField.getDefaultAppearance() ?? "", /11 Tf/);
  assert.deepEqual(
    rectOf(name.acroField.getWidgets()[0]!.dict),
    [40, 500, 240, 520],
  );
  assert.ok(form.getTextField("notes").isMultiline());
  assert.match(
    form.getTextField("notes").acroField.getDefaultAppearance() ?? "",
    /10 Tf/,
  );
  assert.ok(form.getCheckBox("agree").isChecked());
  assert.ok(
    form.getCheckBox("agree").acroField.dict.get(PDFName.of("DV")) instanceof
      PDFName,
  );
  const size = form.getRadioGroup("size");
  assert.deepEqual(size.getOptions(), ["S", "M", "L"]);
  assert.equal(size.getSelected(), "M");
  assert.equal(size.acroField.getWidgets().length, 3);
  const country = form.getDropdown("country");
  assert.deepEqual(country.getOptions(), ["Australia", "Japan"]);
  assert.deepEqual(country.getSelected(), ["Japan"]);
  assert.ok(country.isReadOnly());
  const when = form.getTextField("when");
  const aa = when.acroField.dict.lookup(PDFName.of("AA"), PDFDict);
  const format = aa.lookup(PDFName.of("F"), PDFDict).lookup(PDFName.of("JS"));
  assert.ok(format instanceof PDFHexString || format instanceof PDFString);
  assert.equal(format.decodeText(), 'AFDate_FormatEx("yyyy-mm-dd");');
  const signer = form.getField("signer");
  assert.ok(signer instanceof PDFSignature);
  assert.ok(signer.isRequired());
  assert.deepEqual(rectOf(signer.acroField.dict), [40, 400, 220, 444]);
  assert.equal(document.getPage(1).node.Annots()?.size(), 2);
  assert.equal(document.getPage(0).node.Annots()?.size(), 1 + 1 + 1 + 3 + 1);
});

test("update, move, resize and delete", async () => {
  let bytes = await applyFieldOps(
    await plainPdf(),
    all.slice(0, 5).map((field) => ({ type: "add", field })),
  );
  bytes = await applyFieldOps(bytes, [
    {
      type: "update",
      name: "name",
      changes: {
        name: "full_name",
        required: false,
        readOnly: true,
        defaultValue: "Grace",
        fontSize: 14,
      },
    },
    {
      type: "update",
      name: "country",
      changes: {
        options: ["France", "Japan", "Peru"],
        defaultValue: "Peru",
        readOnly: false,
      },
    },
    { type: "update", name: "agree", changes: { defaultValue: "" } },
  ]);
  let document = await PDFDocument.load(bytes);
  let form = document.getForm();
  assert.equal(form.getFieldMaybe("name"), undefined);
  const renamed = form.getTextField("full_name");
  assert.equal(renamed.getText(), "Grace");
  assert.ok(!renamed.isRequired() && renamed.isReadOnly());
  assert.match(renamed.acroField.getDefaultAppearance() ?? "", /14 Tf/);
  assert.deepEqual(form.getDropdown("country").getOptions(), [
    "France",
    "Japan",
    "Peru",
  ]);
  assert.deepEqual(form.getDropdown("country").getSelected(), ["Peru"]);
  assert.ok(!form.getCheckBox("agree").isChecked());
  await assert.rejects(
    applyFieldOps(bytes, [
      { type: "update", name: "notes", changes: { name: "agree" } },
    ]),
    FieldOpError,
  );
  await assert.rejects(
    applyFieldOps(bytes, [
      { type: "add", field: { ...all[1]!, name: "notes" } },
    ]),
    /already exists/,
  );

  const ref = (field: string, index = 0) => {
    const widget = form.getField(field).acroField.getWidgets()[index]!;
    const found = document.context.getObjectRef(widget.dict)!;
    return { num: found.objectNumber, gen: found.generationNumber };
  };
  const notes = ref("notes");
  const medium = ref("size", 1);
  const agree = ref("agree");
  bytes = await applyFieldOps(bytes, [
    { type: "move", widget: notes, rect: [100, 100, 300, 200] },
    { type: "delete", widget: medium },
    { type: "delete", widget: agree },
  ]);
  document = await PDFDocument.load(bytes);
  form = document.getForm();
  assert.deepEqual(
    rectOf(form.getTextField("notes").acroField.getWidgets()[0]!.dict),
    [100, 100, 300, 200],
  );
  assert.equal(form.getRadioGroup("size").acroField.getWidgets().length, 2);
  assert.equal(form.getFieldMaybe("agree"), undefined);
  assert.equal(document.getPage(0).node.Annots()?.size(), 1 + 1 + 2 + 1);
  assert.ok(!(form.getFieldMaybe("agree") instanceof PDFCheckBox));
  assert.ok(
    form.getField("country") instanceof PDFDropdown &&
      form.getField("size") instanceof PDFRadioGroup &&
      form.getField("notes") instanceof PDFTextField,
  );
  await assert.rejects(
    applyFieldOps(bytes, [{ type: "delete", widget: agree }]),
    /no longer/,
  );
});

test("fields on a rotated page keep the drawn rect and read upright", async () => {
  const bytes = await applyFieldOps(await plainPdf(90), [
    {
      type: "add",
      field: { kind: "text", name: "t", page: 0, rect: [40, 100, 70, 300] },
    },
  ]);
  const document = await PDFDocument.load(bytes);
  const widget = document
    .getForm()
    .getTextField("t")
    .acroField.getWidgets()[0]!;
  assert.deepEqual(rectOf(widget.dict), [40, 100, 70, 300]);
  assert.equal(widget.getAppearanceCharacteristics()?.getRotation(), 90);
});

test("XFA forms are refused instead of silently stripped", async () => {
  const document = await PDFDocument.create();
  document.addPage();
  document
    .getForm()
    .acroForm.dict.set(PDFName.of("XFA"), document.context.obj([]));
  await assert.rejects(
    applyFieldOps(await document.save(), [
      {
        type: "add",
        field: { kind: "text", name: "x", page: 0, rect: [0, 0, 100, 20] },
      },
    ]),
    /XFA/,
  );
});
