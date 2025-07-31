import { memo } from 'react';

interface UIResourceRendererProps {
    resourceJson: string;
}

interface Resource {
    uri: string;
    type?: string;
    name?: string;
    [key: string]: unknown;
}

interface UIActionResult {
    action: string;
    resource: Resource;
}

const NonMemoizedUIResourceRenderer = ({ resourceJson }: UIResourceRendererProps) => {
    let resource: Resource;
    try {
        resource = JSON.parse(resourceJson) as Resource;
    } catch (error) {
        return (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                <div className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">Invalid Resource JSON</div>
                <pre className="text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap">
                    {String(error)}
                </pre>
            </div>
        );
    }

    return (
        <div className="p-4 bg-neutral-50 dark:bg-neutral-800 rounded border">
            <div className="space-y-2">
                <div className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                    Resource URI: {resource.uri || 'Unknown'}
                </div>
                {resource.type && (
                    <div className="text-sm text-neutral-600 dark:text-neutral-400">
                        Type: {resource.type}
                    </div>
                )}
                {resource.name && (
                    <div className="text-sm text-neutral-600 dark:text-neutral-400">
                        Name: {resource.name}
                    </div>
                )}
                <button
                    onClick={() => {
                        const result: UIActionResult = { action: 'view', resource };
                        console.log('Action:', result);
                        return { status: 'handled' };
                    }}
                    className="mt-2 px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                >
                    View Resource
                </button>
            </div>
        </div>
    );
};

export const UIResourceRenderer = memo(
    NonMemoizedUIResourceRenderer,
    (prevProps, nextProps) => prevProps.resourceJson === nextProps.resourceJson,
);
