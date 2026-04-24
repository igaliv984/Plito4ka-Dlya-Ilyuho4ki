import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CD_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

function readUInt16LE(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function readUInt32LE(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (readUInt32LE(buffer, offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }

  throw new Error("XLSX zip footer not found");
}

function readZipEntries(buffer: Buffer): Map<string, ZipEntry> {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const centralDirectoryOffset = readUInt32LE(buffer, eocdOffset + 16);
  const totalEntries = readUInt16LE(buffer, eocdOffset + 10);
  const entries = new Map<string, ZipEntry>();
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (readUInt32LE(buffer, cursor) !== CD_SIGNATURE) {
      throw new Error("Invalid XLSX central directory");
    }

    const method = readUInt16LE(buffer, cursor + 10);
    const compressedSize = readUInt32LE(buffer, cursor + 20);
    const uncompressedSize = readUInt32LE(buffer, cursor + 24);
    const fileNameLength = readUInt16LE(buffer, cursor + 28);
    const extraFieldLength = readUInt16LE(buffer, cursor + 30);
    const fileCommentLength = readUInt16LE(buffer, cursor + 32);
    const localHeaderOffset = readUInt32LE(buffer, cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + fileNameLength);

    entries.set(name, {
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });

    cursor += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
}

function extractEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const offset = entry.localHeaderOffset;
  if (readUInt32LE(buffer, offset) !== LOCAL_FILE_SIGNATURE) {
    throw new Error(`Invalid XLSX local header for ${entry.name}`);
  }

  const fileNameLength = readUInt16LE(buffer, offset + 26);
  const extraFieldLength = readUInt16LE(buffer, offset + 28);
  const dataOffset = offset + 30 + fileNameLength + extraFieldLength;
  const raw = buffer.subarray(dataOffset, dataOffset + entry.compressedSize);

  if (entry.method === 0) {
    return raw;
  }

  if (entry.method === 8) {
    return inflateRawSync(raw);
  }

  throw new Error(`Unsupported XLSX compression method: ${entry.method}`);
}

function readXmlString(buffer: Buffer, entry: ZipEntry): string {
  return extractEntry(buffer, entry).toString("utf8");
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function stripXmlTags(value: string): string {
  return decodeXmlText(value.replace(/<[^>]+>/g, ""));
}

function columnRefToIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, "");
  let result = 0;

  for (let index = 0; index < letters.length; index += 1) {
    result = result * 26 + (letters.charCodeAt(index) - 64);
  }

  return result - 1;
}

function getSharedStrings(buffer: Buffer, entries: Map<string, ZipEntry>): string[] {
  const entry = entries.get("xl/sharedStrings.xml");
  if (!entry) {
    return [];
  }

  const xml = readXmlString(buffer, entry);
  const matches = [...xml.matchAll(/<si[\s\S]*?<\/si>/g)];

  return matches.map((match) => stripXmlTags(match[0]));
}

function getSheetNames(buffer: Buffer, entries: Map<string, ZipEntry>): string[] {
  const workbookEntry = entries.get("xl/workbook.xml");
  if (!workbookEntry) {
    throw new Error("Workbook XML not found");
  }

  const workbookXml = readXmlString(buffer, workbookEntry);
  return [...workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((match) => match[1]);
}

function getSheetTargetMap(buffer: Buffer, entries: Map<string, ZipEntry>): Map<string, string> {
  const relsEntry = entries.get("xl/_rels/workbook.xml.rels");
  if (!relsEntry) {
    throw new Error("Workbook rels not found");
  }

  const relsXml = readXmlString(buffer, relsEntry);
  const map = new Map<string, string>();

  for (const match of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    map.set(match[1], match[2]);
  }

  return map;
}

function resolveSheetEntryName(buffer: Buffer, entries: Map<string, ZipEntry>, sheetIndex = 0): string {
  const workbookEntry = entries.get("xl/workbook.xml");
  if (!workbookEntry) {
    throw new Error("Workbook XML not found");
  }

  const workbookXml = readXmlString(buffer, workbookEntry);
  const relMap = getSheetTargetMap(buffer, entries);
  const sheetMatches = [...workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)];
  const target = sheetMatches[sheetIndex]?.[2];
  if (!target) {
    throw new Error("No worksheets found in XLSX");
  }

  const relTarget = relMap.get(target);
  if (!relTarget) {
    throw new Error(`Worksheet relation ${target} not found`);
  }

  return relTarget.startsWith("xl/") ? relTarget : `xl/${relTarget}`;
}

function getSheetRows(buffer: Buffer, entries: Map<string, ZipEntry>, sheetEntryName: string): string[][] {
  const entry = entries.get(sheetEntryName);
  if (!entry) {
    throw new Error(`Sheet entry not found: ${sheetEntryName}`);
  }

  const sharedStrings = getSharedStrings(buffer, entries);
  const xml = readXmlString(buffer, entry);
  const rows: string[][] = [];

  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowXml = rowMatch[1];
    const row: string[] = [];

    for (const cellMatch of rowXml.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const cellXml = cellMatch[2];
      const refMatch = attrs.match(/\br="([A-Z]+\d+)"/);
      const typeMatch = attrs.match(/\bt="([^"]+)"/);
      const valueMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
      const inlineMatch = cellXml.match(/<is>[\s\S]*?<t>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
      const cellType = typeMatch?.[1] ?? "";
      const cellIndex = refMatch ? columnRefToIndex(refMatch[1]) : row.length;
      let value = "";

      if (cellType === "inlineStr" && inlineMatch) {
        value = stripXmlTags(inlineMatch[1]);
      } else if (valueMatch) {
        const rawValue = decodeXmlText(valueMatch[1]);
        value = cellType === "s" ? sharedStrings[Number(rawValue)] ?? "" : rawValue;
      }

      while (row.length < cellIndex) {
        row.push("");
      }
      row[cellIndex] = value;
    }

    rows.push(row);
  }

  return rows;
}

export async function readXlsxRows(filePath: string, sheetIndex = 0): Promise<string[][]> {
  if (!existsSync(filePath)) {
    throw new Error(`XLSX file not found: ${filePath}`);
  }

  const buffer = await readFile(filePath);
  const entries = readZipEntries(buffer);
  const sheetEntryName = resolveSheetEntryName(buffer, entries, sheetIndex);
  return getSheetRows(buffer, entries, sheetEntryName);
}
