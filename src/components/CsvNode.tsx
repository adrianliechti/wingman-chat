import { memo, useMemo } from 'react';
import { Table } from 'lucide-react';
import type { Node, NodeProps } from '@xyflow/react';
import type { BaseNodeData, Data } from '../types/workflow';
import { getDataText } from '../types/workflow';
import { useWorkflow } from '../hooks/useWorkflow';
import { useWorkflowNode } from '../hooks/useWorkflowNode';
import { getConfig } from '../config';
import { WorkflowNode } from './WorkflowNode';
import { CopyButton } from './CopyButton';

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
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes) {
      if (char === ',') commaCount++;
      if (char === ';') semicolonCount++;
      if (char === '\t') tabCount++;
    }
  }
  
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
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === separator && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    row.push(current.trim());
    result.push(row);
  }
  
  return result;
};

// CsvNode data interface
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CsvNodeData extends BaseNodeData {
}

// CsvNode type
export type CsvNodeType = Node<CsvNodeData, 'csv'>;

export const CsvNode = memo(({ id, data, selected }: NodeProps<CsvNodeType>) => {
  const { updateNode } = useWorkflow();
  const { getText, hasConnections, isProcessing, executeAsync } = useWorkflowNode(id);
  const config = getConfig();
  const client = config.client;

  const csvText = data.output ? getDataText(data.output) : '';
  const parsedData = useMemo(() => parseCSV(csvText), [csvText]);
  const headers = parsedData.length > 0 ? parsedData[0] : [];
  const rows = parsedData.slice(1);

  const handleExecute = async () => {
    // Get input from connected nodes only
    const inputContent = getText();
    
    if (!inputContent) return;
    
    await executeAsync(async () => {
      // Clear any previous error when starting a new execution
      updateNode(id, {
        data: { ...data, error: undefined }
      });
      
      try {
        // Use the convertCSV method from the client
        const csvData = await client.convertCSV('', inputContent);

        // Parse CSV into rows (skip empty lines)
        const lines = csvData.split('\n').filter(line => line.trim());
        const headerLine = lines[0] || '';
        const dataLines = lines.slice(1);

        // Create data with each row as a separate item
        const result: Data<string> = {
          text: csvData,  // Full CSV for getDataText
          items: dataLines.map(line => ({
            value: line,
            text: `${headerLine}\n${line}`  // Each item includes header + row
          }))
        };

        // Set final data
        updateNode(id, {
          data: { ...data, output: result, error: undefined }
        });
      } catch (error) {
        console.error('Error extracting CSV:', error);
        updateNode(id, {
          data: { ...data, error: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }
        });
      }
    });
  };

  return (
    <WorkflowNode
      id={id}
      selected={selected}
      icon={Table}
      title="CSV"
      color="green"
      onExecute={handleExecute}
      isProcessing={isProcessing}
      canExecute={hasConnections}
      showInputHandle={true}
      showOutputHandle={true}
      minWidth={500}
      error={data.error}
      headerActions={
        data.output && <CopyButton text={getDataText(data.output)} />
      }
    >
      <div className="flex-1 flex items-center justify-center min-h-0 p-4">
        {data.output ? (
          <div className="w-full h-full overflow-auto scrollbar-hide">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-neutral-700">
              <thead>
                <tr>
                  {headers.map((header, index) => (
                    <th
                      key={index}
                      className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-neutral-400 uppercase tracking-wider border-r border-gray-200 dark:border-neutral-700 last:border-r-0"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-neutral-700">
                {rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="px-3 py-2 text-sm text-gray-900 dark:text-neutral-100 border-r border-gray-200 dark:border-neutral-700 last:border-r-0"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 text-gray-400 dark:text-gray-600">
            <Table size={48} strokeWidth={1} />
          </div>
        )}
      </div>
    </WorkflowNode>
  );
});
