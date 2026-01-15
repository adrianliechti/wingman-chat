import JSZip from 'jszip';

interface ConversionResult {
  sheetName: string;
  csv: string;
  rowCount: number;
}

interface SharedStrings {
  strings: string[];
}

/**
 * Converts an XLSX file to multiple CSV strings (one per sheet)
 */
export async function xlsxToCsv(file: File): Promise<ConversionResult[]> {
  const zip = await JSZip.loadAsync(file);
  
  // Parse shared strings (XLSX stores repeated strings in a lookup table)
  const sharedStrings = await parseSharedStrings(zip);
  
  // Get sheet names from workbook.xml
  const sheetNames = await parseWorkbook(zip);
  
  // Parse each sheet
  const results: ConversionResult[] = [];
  
  for (let i = 0; i < sheetNames.length; i++) {
    const sheetPath = `xl/worksheets/sheet${i + 1}.xml`;
    const sheetXml = await zip.file(sheetPath)?.async('string');
    
    if (!sheetXml) continue;
    
    const csv = parseSheet(sheetXml, sharedStrings);
    const rowCount = csv.split('\n').filter(row => row.trim()).length;
    
    results.push({
      sheetName: sheetNames[i],
      csv,
      rowCount
    });
  }
  
  return results;
}

/**
 * Parses the shared strings XML file
 */
async function parseSharedStrings(zip: JSZip): Promise<SharedStrings> {
  const content = await zip.file('xl/sharedStrings.xml')?.async('string');
  
  if (!content) {
    return { strings: [] };
  }
  
  const strings: string[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'application/xml');
  
  // Shared strings are stored in <si> elements
  const siElements = doc.getElementsByTagName('si');
  
  for (const si of siElements) {
    // Text can be in <t> directly or in <r><t> (rich text)
    const tElements = si.getElementsByTagName('t');
    let text = '';
    for (const t of tElements) {
      text += t.textContent ?? '';
    }
    strings.push(text);
  }
  
  return { strings };
}

/**
 * Parses workbook.xml to get sheet names
 */
async function parseWorkbook(zip: JSZip): Promise<string[]> {
  const content = await zip.file('xl/workbook.xml')?.async('string');
  
  if (!content) {
    return ['Sheet1'];
  }
  
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'application/xml');
  const sheets = doc.getElementsByTagName('sheet');
  
  const names: string[] = [];
  for (const sheet of sheets) {
    const name = sheet.getAttribute('name');
    if (name) {
      names.push(name);
    }
  }
  
  return names.length > 0 ? names : ['Sheet1'];
}

/**
 * Parses a sheet XML and converts it to CSV
 */
function parseSheet(xml: string, sharedStrings: SharedStrings): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  
  const rows = doc.getElementsByTagName('row');
  const csvRows: string[] = [];
  
  for (const row of rows) {
    const cells = row.getElementsByTagName('c');
    const rowData: Map<number, string> = new Map();
    let maxCol = 0;
    
    for (const cell of cells) {
      const ref = cell.getAttribute('r'); // e.g., "A1", "B2"
      if (!ref) continue;
      
      const colIndex = cellRefToColIndex(ref);
      maxCol = Math.max(maxCol, colIndex);
      
      const value = getCellValue(cell, sharedStrings);
      rowData.set(colIndex, value);
    }
    
    // Build CSV row with proper column positioning
    const csvCells: string[] = [];
    for (let i = 0; i <= maxCol; i++) {
      csvCells.push(rowData.get(i) ?? '');
    }
    
    csvRows.push(csvCells.map(escapeCsvValue).join(','));
  }
  
  return csvRows.join('\n');
}

/**
 * Converts cell reference (e.g., "A1", "AA1") to zero-based column index
 */
function cellRefToColIndex(ref: string): number {
  const match = ref.match(/^([A-Z]+)/);
  if (!match) return 0;
  
  const letters = match[1];
  let index = 0;
  
  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  
  return index - 1; // Zero-based
}

/**
 * Extracts the value from a cell element
 */
function getCellValue(cell: Element, sharedStrings: SharedStrings): string {
  const type = cell.getAttribute('t');
  const valueEl = cell.getElementsByTagName('v')[0];
  const value = valueEl?.textContent ?? '';
  
  // Type 's' means shared string
  if (type === 's') {
    const index = parseInt(value, 10);
    return sharedStrings.strings[index] ?? '';
  }
  
  // Type 'inlineStr' means inline string
  if (type === 'inlineStr') {
    const isEl = cell.getElementsByTagName('is')[0];
    const tEl = isEl?.getElementsByTagName('t')[0];
    return tEl?.textContent ?? '';
  }
  
  // Type 'b' means boolean
  if (type === 'b') {
    return value === '1' ? 'TRUE' : 'FALSE';
  }
  
  // Type 'e' means error
  if (type === 'e') {
    return value; // Return error code as-is
  }
  
  // Default: number or formula result
  return value;
}

/**
 * Escapes a value for CSV output
 */
function escapeCsvValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Triggers download of a CSV file
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  link.click();
  
  URL.revokeObjectURL(url);
}