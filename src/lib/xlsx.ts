/*
 * Минимальная работа с Excel (.xlsx) без внешних пакетов.
 * - buildXlsx: собирает книгу (листы, стили, объединённые ячейки, ширины, печать).
 * - readXlsxRows: читает первый лист .xlsx в массив строк (для импорта сотрудников).
 * Работает и в браузере, и на сервере (нужны TextEncoder и DecompressionStream).
 */

// ===== ЗАПИСЬ =====

export type CellStyle = {
  bold?: boolean;
  italic?: boolean;
  size?: number;
  color?: string; // цвет текста, RRGGBB
  fill?: string; // заливка, RRGGBB
  border?: boolean;
  align?: "left" | "center" | "right";
  valign?: "top" | "center";
  wrap?: boolean;
  numFmt?: string; // например "0.0"
};

export type Cell = { v?: string | number | null; s?: CellStyle };

export type Sheet = {
  name: string;
  rows: (Cell | null | undefined)[][];
  colWidths?: number[]; // в символах
  rowHeights?: Record<number, number>; // номер строки с 0 -> пункты
  merges?: [number, number, number, number][]; // [строка1, колонка1, строка2, колонка2] с 0
  freeze?: { rows?: number; cols?: number };
  landscape?: boolean;
  fitToWidth?: boolean;
  // строки (с 0), которые повторяются в начале каждой печатной страницы
  printTitleRows?: [number, number];
  // колонтитул внизу страницы; &P — номер страницы, &N — всего страниц
  footer?: { left?: string; right?: string };
};

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // символы, недопустимые в XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

export function colLetter(index: number) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ZIP без сжатия (метод 0) — для небольших файлов этого достаточно
function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0),
    ]);
    chunks.push(local, name, f.data);
    central.push(
      new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21),
        ...u32(crc), ...u32(f.data.length), ...u32(f.data.length), ...u16(name.length), ...u16(0), ...u16(0),
        ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
      ]),
      name
    );
    offset += local.length + name.length + f.data.length;
  }

  const centralSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);

  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let pos = 0;
  for (const c of all) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

export function buildXlsx(sheets: Sheet[]): Uint8Array {
  const enc = new TextEncoder();

  // реестры стилей
  const fonts: string[] = ['<font><sz val="10"/><name val="Arial"/></font>'];
  const fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const numFmts: string[] = [];
  const xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const xfIndex = new Map<string, number>();

  const fontId = (s: CellStyle) => {
    if (!s.bold && !s.italic && !s.size && !s.color) return 0;
    const xml = `<font>${s.bold ? "<b/>" : ""}${s.italic ? "<i/>" : ""}<sz val="${s.size ?? 10}"/>${s.color ? `<color rgb="FF${s.color}"/>` : ""}<name val="Arial"/></font>`;
    let i = fonts.indexOf(xml);
    if (i < 0) { fonts.push(xml); i = fonts.length - 1; }
    return i;
  };
  const fillId = (s: CellStyle) => {
    if (!s.fill) return 0;
    const xml = `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/><bgColor indexed="64"/></patternFill></fill>`;
    let i = fills.indexOf(xml);
    if (i < 0) { fills.push(xml); i = fills.length - 1; }
    return i;
  };
  const numFmtId = (s: CellStyle) => {
    if (!s.numFmt) return 0;
    let i = numFmts.indexOf(s.numFmt);
    if (i < 0) { numFmts.push(s.numFmt); i = numFmts.length - 1; }
    return 164 + i;
  };
  const styleId = (s?: CellStyle) => {
    if (!s) return 0;
    const key = JSON.stringify(s);
    const hit = xfIndex.get(key);
    if (hit !== undefined) return hit;
    const align = s.align || s.valign || s.wrap
      ? `<alignment${s.align ? ` horizontal="${s.align}"` : ""} vertical="${s.valign ?? "center"}"${s.wrap ? ' wrapText="1"' : ""}/>`
      : "";
    const xml = `<xf numFmtId="${numFmtId(s)}" fontId="${fontId(s)}" fillId="${fillId(s)}" borderId="${s.border ? 1 : 0}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1">${align}</xf>`;
    xfs.push(xml);
    xfIndex.set(key, xfs.length - 1);
    return xfs.length - 1;
  };

  const sheetXml = sheets.map((sh) => {
    const maxCols = Math.max(1, ...sh.rows.map((r) => r.length), sh.colWidths?.length ?? 0);
    const cols = sh.colWidths
      ? `<cols>${sh.colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
      : "";
    const rowsXml = sh.rows.map((row, r) => {
      const h = sh.rowHeights?.[r];
      const cells = row.map((cell, c) => {
        if (!cell) return "";
        const ref = `${colLetter(c)}${r + 1}`;
        const s = styleId(cell.s);
        const sAttr = s ? ` s="${s}"` : "";
        if (cell.v === undefined || cell.v === null || cell.v === "") return `<c r="${ref}"${sAttr}/>`;
        if (typeof cell.v === "number" && Number.isFinite(cell.v)) return `<c r="${ref}"${sAttr}><v>${cell.v}</v></c>`;
        return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(String(cell.v))}</t></is></c>`;
      }).join("");
      return `<row r="${r + 1}"${h ? ` ht="${h}" customHeight="1"` : ""}>${cells}</row>`;
    }).join("");
    const merges = sh.merges?.length
      ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(([r1, c1, r2, c2]) => `<mergeCell ref="${colLetter(c1)}${r1 + 1}:${colLetter(c2)}${r2 + 1}"/>`).join("")}</mergeCells>`
      : "";
    const pane = sh.freeze && (sh.freeze.rows || sh.freeze.cols)
      ? `<sheetViews><sheetView workbookViewId="0"><pane${sh.freeze.cols ? ` xSplit="${sh.freeze.cols}"` : ""}${sh.freeze.rows ? ` ySplit="${sh.freeze.rows}"` : ""} topLeftCell="${colLetter(sh.freeze.cols ?? 0)}${(sh.freeze.rows ?? 0) + 1}" state="frozen"/></sheetView></sheetViews>`
      : "";
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${colLetter(maxCols - 1)}${Math.max(1, sh.rows.length)}"/>${pane}` +
      `<sheetFormatPr defaultRowHeight="13.5"/>${cols}<sheetData>${rowsXml}</sheetData>${merges}` +
      `<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>` +
      `<pageSetup paperSize="9" orientation="${sh.landscape === false ? "portrait" : "landscape"}" fitToWidth="1" fitToHeight="0"/>` +
      (sh.footer ? `<headerFooter><oddFooter>${esc(`${sh.footer.left ? `&L${sh.footer.left}` : ""}${sh.footer.right ? `&R${sh.footer.right}` : ""}`)}</oddFooter></headerFooter>` : "") +
      `</worksheet>`
    );
  });

  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join("")}</numFmts>` : "") +
    `<fonts count="${fonts.length}">${fonts.join("")}</fonts><fills count="${fills.length}">${fills.join("")}</fills>` +
    `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
    `<border><left style="thin"><color rgb="FF8A8A8A"/></left><right style="thin"><color rgb="FF8A8A8A"/></right><top style="thin"><color rgb="FF8A8A8A"/></top><bottom style="thin"><color rgb="FF8A8A8A"/></bottom><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

  // имена листов: до 31 символа, без \ / ? * [ ] :
  const used = new Set<string>();
  const names = sheets.map((sh, i) => {
    let base = sh.name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || `Лист ${i + 1}`;
    let n = base;
    let k = 2;
    while (used.has(n.toLowerCase())) n = `${base.slice(0, 28)} ${k++}`;
    used.add(n.toLowerCase());
    return n;
  });

  const titles = sheets.some((sh) => sh.printTitleRows)
    ? `<definedNames>${sheets.map((sh, i) => (sh.printTitleRows ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${esc(names[i]).replace(/'/g, "''")}'!$${sh.printTitleRows[0] + 1}:$${sh.printTitleRows[1] + 1}</definedName>` : "")).join("")}</definedNames>`
    : "";

  const files: { name: string; data: Uint8Array }[] = [
    {
      name: "[Content_Types].xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`
      ),
    },
    {
      name: "_rels/.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
      ),
    },
    {
      name: "xl/workbook.xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${titles}</workbook>`
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
      ),
    },
    { name: "xl/styles.xml", data: enc.encode(styles) },
    ...sheetXml.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(x) })),
  ];

  return zipStore(files);
}

// ===== ЧТЕНИЕ =====

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Это не файл Excel (.xlsx)");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();

  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    if (name.startsWith("xl/worksheets/") || name === "xl/sharedStrings.xml" || name === "xl/workbook.xml" || name === "xl/_rels/workbook.xml.rels") {
      out.set(name, method === 0 ? raw : await inflateRaw(raw));
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const unesc = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

const textOf = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join("");

function colIndex(ref: string) {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// Первый лист книги -> строки текста. Числа возвращаются как есть (строкой):
// даты Excel (серийные числа) разбирает вызывающий код.
export async function readXlsxRows(file: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const buf = file instanceof Uint8Array ? file : new Uint8Array(file);
  const files = await unzip(buf);
  const dec = new TextDecoder();

  const shared: string[] = [];
  const sst = files.get("xl/sharedStrings.xml");
  if (sst) {
    for (const m of dec.decode(sst).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  }

  let sheetPath = "xl/worksheets/sheet1.xml";
  if (!files.has(sheetPath)) {
    sheetPath = [...files.keys()].filter((k) => k.startsWith("xl/worksheets/") && k.endsWith(".xml")).sort()[0];
  }
  const sheet = sheetPath ? files.get(sheetPath) : undefined;
  if (!sheet) throw new Error("В книге нет листов");

  const rows: string[][] = [];
  for (const rm of dec.decode(sheet).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? "";
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /t="(\w+)"/.exec(attrs)?.[1];
      if (!ref) continue;
      let value = "";
      if (type === "s") value = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1])] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else value = unesc(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "");
      row[colIndex(ref)] = value;
    }
    rows.push(Array.from(row, (v) => v ?? ""));
  }
  return rows;
}
