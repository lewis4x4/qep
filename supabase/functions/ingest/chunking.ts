export type UploadKind = "pdf" | "docx" | "spreadsheet" | "text";
export type ChunkKind = "paragraph" | "section";

export interface PreparedChunkRow {
  id: string;
  chunk_index: number;
  content: string;
  token_count: number;
  chunk_kind: ChunkKind;
  parent_chunk_id: string | null;
  metadata: Record<string, unknown>;
}

interface ParsedSection {
  sectionTitle: string | null;
  pageNumber: number | null;
  paragraphs: string[];
}

interface ChunkBuildResult {
  strategy: "semantic_v1" | "legacy_fixed";
  chunks: PreparedChunkRow[];
}

const LEGACY_CHUNK_SIZE = 512;
const LEGACY_CHUNK_OVERLAP = 50;
const PARAGRAPH_MIN_TOKENS = 250;
const PARAGRAPH_MAX_TOKENS = 450;
const SECTION_MIN_TOKENS = 1400;
const SECTION_MAX_TOKENS = 2200;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildDocumentChunks(input: {
  rawText: string;
  uploadKind: UploadKind;
  title?: string | null;
}): ChunkBuildResult {
  const normalized = normalizeText(input.rawText);
  if (!normalized) {
    return { strategy: "semantic_v1", chunks: [] };
  }

  const parsed = input.uploadKind === "spreadsheet"
    ? parseSpreadsheetSections(normalized)
    : parseStructuredSections(normalized, input.uploadKind, input.title ?? null);

  if (shouldUseLegacyFixed(parsed)) {
    return {
      strategy: "legacy_fixed",
      chunks: buildLegacyFixedChunks(normalized),
    };
  }

  return {
    strategy: "semantic_v1",
    chunks: buildHierarchicalRows(parsed, input.uploadKind),
  };
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseSpreadsheetSections(text: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let currentTitle: string | null = null;
  let currentRows: string[] = [];

  const flush = () => {
    const rows = currentRows
      .map((row) => row.trim())
      .filter((row) => row.length > 0);
    if (rows.length === 0) {
      currentRows = [];
      return;
    }
    sections.push({
      sectionTitle: currentTitle,
      pageNumber: null,
      paragraphs: rows,
    });
    currentRows = [];
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const sheetMatch = trimmed.match(/^Sheet:\s*(.+)$/i);
    if (sheetMatch) {
      flush();
      currentTitle = sheetMatch[1].trim() || null;
      continue;
    }
    currentRows.push(line);
  }

  flush();
  return sections;
}

function parseStructuredSections(
  text: string,
  uploadKind: Exclude<UploadKind, "spreadsheet">,
  title: string | null,
): ParsedSection[] {
  const pages = text.includes("\f")
    ? text.split(/\f+/).map((page) => page.trim()).filter(Boolean)
    : [text];
  const sections: ParsedSection[] = [];

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const lines = page.split("\n");
    let currentTitle: string | null = null;
    let paragraphLines: string[] = [];
    let sectionParagraphs: string[] = [];

    const ensureSection = () => {
      if (sectionParagraphs.length === 0 && currentTitle == null) return;
      sections.push({
        sectionTitle: currentTitle,
        pageNumber: pages.length > 1 ? pageIndex + 1 : null,
        paragraphs: [...sectionParagraphs],
      });
      sectionParagraphs = [];
    };

    const flushParagraph = () => {
      if (paragraphLines.length === 0) return;
      const paragraph = compactWhitespace(paragraphLines.join(" "));
      if (paragraph) sectionParagraphs.push(paragraph);
      paragraphLines = [];
    };

    for (let i = 0; i < lines.length; i += 1) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();
      const nextLine = lines.slice(i + 1).find((line) => line.trim().length > 0)?.trim() ?? "";

      if (!trimmed) {
        flushParagraph();
        continue;
      }

      const heading = extractHeading(trimmed, nextLine, uploadKind, i === 0 ? title : null);
      if (heading) {
        flushParagraph();
        if (sectionParagraphs.length > 0 || currentTitle != null) {
          ensureSection();
        }
        currentTitle = heading;
        continue;
      }

      paragraphLines.push(trimmed);
    }

    flushParagraph();
    ensureSection();
  }

  return sections.filter((section) => section.paragraphs.length > 0);
}

function extractHeading(
  line: string,
  nextLine: string,
  uploadKind: Exclude<UploadKind, "spreadsheet">,
  docTitleHint: string | null,
): string | null {
  const markdownMatch = line.match(/^#{1,6}\s+(.+)$/);
  if (markdownMatch) return markdownMatch[1].trim();

  if (docTitleHint && normalizeHeading(docTitleHint) === normalizeHeading(line)) {
    return line;
  }

  if (line.length > 90 || countWords(line) > 12) return null;
  if (/[.!?]$/.test(line)) return null;

  const isAllCaps = /^[A-Z0-9/&\-(),:'"\s]+$/.test(line) && /[A-Z]/.test(line);
  const isColonHeading = /:$/.test(line);
  const isNumberedHeading = /^\d+(\.\d+)*[\])\. -]+\S/.test(line);
  const isTitleCase = /^([A-Z][a-z0-9'/-]+|[A-Z]{2,})(\s+([A-Z][a-z0-9'/-]+|[A-Z]{2,})){0,8}$/.test(line);
  const separatedFromBody = nextLine.length > 0 && nextLine.length > line.length;

  if (isColonHeading || isAllCaps || isNumberedHeading) return line.replace(/:$/, "").trim();
  if (uploadKind !== "text" && isTitleCase && separatedFromBody) return line.trim();
  if (uploadKind === "text" && isTitleCase && separatedFromBody && line.length <= 60) return line.trim();

  return null;
}

function normalizeHeading(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function countWords(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function shouldUseLegacyFixed(sections: ParsedSection[]): boolean {
  if (sections.length === 0) return true;
  const paragraphs = sections.flatMap((section) => section.paragraphs);
  if (paragraphs.length === 0) return true;

  const hasExplicitStructure = sections.some((section) => section.sectionTitle || section.pageNumber != null);
  const shortParagraphs = paragraphs.filter((paragraph) => estimateTokens(paragraph) < 12).length;

  return !hasExplicitStructure && paragraphs.length >= 6 && shortParagraphs / paragraphs.length > 0.75;
}

function buildHierarchicalRows(sections: ParsedSection[], uploadKind: UploadKind): PreparedChunkRow[] {
  const rows: PreparedChunkRow[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const paragraphGroups = packParagraphGroups(section.paragraphs);
    const sectionGroups = packSectionGroups(paragraphGroups);

    for (const group of sectionGroups) {
      const sectionId = crypto.randomUUID();
      const sectionContent = group.paragraphs.join("\n\n");
      const sharedMetadata = {
        chunking_strategy: "semantic_v1",
        upload_kind: uploadKind,
        section_title: section.sectionTitle,
        page_number: section.pageNumber,
      };

      rows.push({
        id: sectionId,
        chunk_index: chunkIndex,
        content: sectionContent,
        token_count: estimateTokens(sectionContent),
        chunk_kind: "section",
        parent_chunk_id: null,
        metadata: sharedMetadata,
      });
      chunkIndex += 1;

      for (const paragraph of group.paragraphs) {
        rows.push({
          id: crypto.randomUUID(),
          chunk_index: chunkIndex,
          content: paragraph,
          token_count: estimateTokens(paragraph),
          chunk_kind: "paragraph",
          parent_chunk_id: sectionId,
          metadata: sharedMetadata,
        });
        chunkIndex += 1;
      }
    }
  }

  return rows;
}

function packParagraphGroups(paragraphs: string[]): string[] {
  const packed: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    packed.push(current.join("\n\n"));
    current = [];
    currentTokens = 0;
  };

  for (const paragraph of paragraphs) {
    const units = splitOversizedParagraph(paragraph, PARAGRAPH_MAX_TOKENS);
    for (const unit of units) {
      const unitTokens = estimateTokens(unit);
      const wouldOverflow = currentTokens > 0 && currentTokens + unitTokens > PARAGRAPH_MAX_TOKENS;
      if (wouldOverflow) flush();
      current.push(unit);
      currentTokens += unitTokens;
      if (currentTokens >= PARAGRAPH_MIN_TOKENS) {
        flush();
      }
    }
  }

  if (current.length > 0) {
    const tail = current.join("\n\n");
    const tailTokens = estimateTokens(tail);
    const previous = packed[packed.length - 1];
    if (previous && tailTokens < PARAGRAPH_MIN_TOKENS) {
      const merged = `${previous}\n\n${tail}`;
      if (estimateTokens(merged) <= PARAGRAPH_MAX_TOKENS + 60) {
        packed[packed.length - 1] = merged;
      } else {
        packed.push(tail);
      }
    } else {
      packed.push(tail);
    }
  }

  return packed;
}

function splitOversizedParagraph(paragraph: string, maxTokens: number): string[] {
  if (estimateTokens(paragraph) <= maxTokens) return [paragraph];

  const sentenceParts = paragraph
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((part) => compactWhitespace(part))
    .filter(Boolean);

  if (sentenceParts.length <= 1) {
    return splitByWords(paragraph, maxTokens);
  }

  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const sentence of sentenceParts) {
    const sentenceTokens = estimateTokens(sentence);
    if (sentenceTokens > maxTokens) {
      if (current.length > 0) {
        chunks.push(current.join(" "));
        current = [];
        currentTokens = 0;
      }
      chunks.push(...splitByWords(sentence, maxTokens));
      continue;
    }

    if (currentTokens > 0 && currentTokens + sentenceTokens > maxTokens) {
      chunks.push(current.join(" "));
      current = [];
      currentTokens = 0;
    }

    current.push(sentence);
    currentTokens += sentenceTokens;
  }

  if (current.length > 0) chunks.push(current.join(" "));
  return chunks;
}

function splitByWords(text: string, maxTokens: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const word of words) {
    const wordTokens = estimateTokens(word);
    if (currentTokens > 0 && currentTokens + wordTokens > maxTokens) {
      chunks.push(current.join(" "));
      current = [];
      currentTokens = 0;
    }
    current.push(word);
    currentTokens += wordTokens;
  }

  if (current.length > 0) chunks.push(current.join(" "));
  return chunks;
}

function packSectionGroups(paragraphs: string[]): Array<{ paragraphs: string[] }> {
  const groups: Array<{ paragraphs: string[] }> = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    groups.push({ paragraphs: [...current] });
    current = [];
    currentTokens = 0;
  };

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph);
    if (currentTokens > 0 && currentTokens + paragraphTokens > SECTION_MAX_TOKENS) {
      flush();
    }

    current.push(paragraph);
    currentTokens += paragraphTokens;

    if (currentTokens >= SECTION_MIN_TOKENS) {
      flush();
    }
  }

  flush();
  return groups;
}

function buildLegacyFixedChunks(text: string): PreparedChunkRow[] {
  const words = text.split(/\s+/).filter(Boolean);
  const rows: PreparedChunkRow[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < words.length) {
    let end = start;
    let tokenCount = 0;

    while (end < words.length && tokenCount < LEGACY_CHUNK_SIZE) {
      tokenCount += estimateTokens(words[end]);
      end += 1;
    }

    const chunk = words.slice(start, end).join(" ").trim();
    if (chunk) {
      rows.push({
        id: crypto.randomUUID(),
        chunk_index: chunkIndex,
        content: chunk,
        token_count: estimateTokens(chunk),
        chunk_kind: "paragraph",
        parent_chunk_id: null,
        metadata: {
          chunking_strategy: "legacy_fixed",
        },
      });
      chunkIndex += 1;
    }

    let overlapTokens = 0;
    let overlapStart = end;
    while (overlapStart > start && overlapTokens < LEGACY_CHUNK_OVERLAP) {
      overlapStart -= 1;
      overlapTokens += estimateTokens(words[overlapStart]);
    }
    start = overlapStart === start ? end : overlapStart;
  }

  return rows;
}
