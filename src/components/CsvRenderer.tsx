import { memo, useState, useMemo } from 'react';
import { CopyButton } from './CopyButton';
import { PreviewButton } from './PreviewButton';

interface CsvRendererProps {
  csv: string;
  language: string;
  name?: string;
}

// Utility function to detect separator (comma, semicolon, or tab)
const detectSeparator = (csv: string): string => {
  if (!csv.trim()) return ',';
  
  const firstLine = csv.trim().split('\n')[0];
  let commaCount = 0;
  let semicolonCount = 0;
  let tabCount = 0;
  let inQuotes = false;
  
  for (let i = 0; i < firstLine.length; i++) {
    const char = firstLine[i];
    const nextChar = firstLine[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes) {
      if (char === ',') commaCount++;
      if (char === ';') semicolonCount++;
      if (char === '\t') tabCount++;
    }
  }
  
  // Return the separator with the highest count
  if (tabCount > 0 && tabCount >= commaCount && tabCount >= semicolonCount) return '\t';
  if (semicolonCount > commaCount) return ';';
  return ',';
};

// Utility function to parse CSV content
const parseCSV = (csv: string): string[][] => {
  if (!csv.trim()) return [];
  
  const separator = detectSeparator(csv);
  const lines = csv.trim().split('\n');
  const result: string[][] = [];
  
  for (const line of lines) {
    const row: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote
          current += '"';
          i++; // Skip next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === separator && !inQuotes) {
        // End of field
        row.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add the last field
    row.push(current.trim());
    result.push(row);
  }
  
  return result;
};

const NonMemoizedCsvRenderer = ({ csv, language, name }: CsvRendererProps) => {
  const [showCode, setShowCode] = useState(false);

  const parsedData = useMemo(() => parseCSV(csv), [csv]);
  const headers = parsedData.length > 0 ? parsedData[0] : [];
  const rows = parsedData.slice(1);

  const isEmpty = !csv.trim() || parsedData.length === 0;

  // Show loading state until CSV has content
  if (isEmpty) {
    return (
      <div className="relative my-4">
        <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
          <span>{name || language}</span>
          <div className="flex items-center gap-2">
            <PreviewButton 
              showCode={showCode} 
              onToggle={() => setShowCode(!showCode)} 
              className="h-4 w-4" 
            />
            <CopyButton text={csv} className="h-4 w-4" />
          </div>
        </div>
        <div className="bg-white dark:bg-neutral-900 rounded-b-md border-l border-r border-b border-gray-100 dark:border-neutral-800">
          {showCode ? (
            <div className="p-4">
              <pre className="text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
                <code>{csv}</code>
              </pre>
            </div>
          ) : (
            <div className="flex items-center justify-center h-24 text-gray-500 dark:text-neutral-500">
              <div className="flex items-center space-x-3">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-gray-600 dark:border-neutral-600 dark:border-t-neutral-400"></div>
                <span>Loading CSV...</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative my-4">
      <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-800 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
        <span>
          {name || language}
        </span>
        <div className="flex items-center gap-2">
          <PreviewButton 
            showCode={showCode} 
            onToggle={() => setShowCode(!showCode)} 
            className="h-4 w-4" 
          />
          <CopyButton text={csv} className="h-4 w-4" />
        </div>
      </div>

      <div className="bg-white dark:bg-neutral-900 rounded-b-md border-l border-r border-b border-gray-100 dark:border-neutral-800">
        {showCode ? (
          <div className="p-4">
            <pre className="text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
              <code>{csv}</code>
            </pre>
          </div>
        ) : (
          <div className="overflow-x-auto">
            {parsedData.length > 0 ? (
              <table className="min-w-full divide-y divide-gray-200 dark:divide-neutral-700">
                <thead className="bg-white dark:bg-neutral-900">
                  <tr>
                    {headers.map((header, index) => (
                      <th
                        key={index}
                        className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider border-r border-gray-200 dark:border-neutral-600 last:border-r-0"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-neutral-900 divide-y divide-gray-200 dark:divide-neutral-700">
                  {rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="hover:bg-gray-50 dark:hover:bg-neutral-800">
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className="px-3 py-2 text-sm text-gray-900 dark:text-neutral-100 border-r border-gray-200 dark:border-neutral-600 last:border-r-0"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-neutral-500">
                No data to display
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const CsvRenderer = memo(
  NonMemoizedCsvRenderer,
  (prevProps, nextProps) =>
    prevProps.csv === nextProps.csv && prevProps.language === nextProps.language && prevProps.name === nextProps.name
);
