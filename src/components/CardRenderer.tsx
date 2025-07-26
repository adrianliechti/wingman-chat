import { memo, useEffect, useRef, useState, useContext } from 'react';
import { Eye, Code } from 'lucide-react';
import { Button } from '@headlessui/react';
import { CopyButton } from './CopyButton';
import { ChatContext } from '../contexts/ChatContext';
import { Role } from '../types/chat';

interface CardRendererProps {
    cardJson: string;
}

const NonMemoizedCardRenderer = ({ cardJson }: CardRendererProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [renderedCard, setRenderedCard] = useState<HTMLElement | null>(null);
    const [error, setError] = useState<string>('');
    const [isComplete, setIsComplete] = useState(false);
    const [showCode, setShowCode] = useState(false);
    const cardsRef = useRef<any>(null);

    const chatContext = useContext(ChatContext);

    // Load libraries once
    useEffect(() => {
        const loadLibraries = async () => {
            try {
                const [cardsModule, remarkModule, remarkHtmlModule, remarkGfmModule, remarkBreaksModule] = await Promise.all([
                    import('adaptivecards'),
                    import('remark'),
                    import('remark-html'),
                    import('remark-gfm'),
                    import('remark-breaks')
                ]);

                cardsRef.current = cardsModule;

                if (cardsModule.AdaptiveCard) {
                    cardsModule.AdaptiveCard.onProcessMarkdown = function (text: string, result: any) {
                        const processor = remarkModule.remark()
                            .use(remarkGfmModule.default)
                            .use(remarkBreaksModule.default)
                            .use(remarkHtmlModule.default);
                        result.outputHtml = processor.processSync(text).toString();
                        result.didProcess = true;
                    };
                }
                setIsComplete(true);
            } catch {
                setError('Failed to load card renderer');
                setIsComplete(false);
            }
        };

        loadLibraries();
    }, []);

    // Simple JSON validation
    const isValidJson = (json: string): boolean => {
        try {
            const parsed = JSON.parse(json);
            return parsed && typeof parsed === 'object';
        } catch {
            return false;
        }
    };

    // Render card when JSON changes
    useEffect(() => {
        const renderCard = async () => {
            if (!cardsRef.current || !isComplete) return;

            if (!cardJson.trim()) {
                setError('');
                setRenderedCard(null);
                return;
            }

            try {
                setError('');

                // Basic validation - check if it looks like valid JSON
                if (!isValidJson(cardJson)) {
                    return;
                }

                const card = new cardsRef.current.AdaptiveCard();
                card.parse(JSON.parse(cardJson));

                // Handle actions
                card.onExecuteAction = (action: any) => {
                    const actionType = action.getJsonTypeName();

                    if (actionType === 'Action.OpenUrl') {
                        window.open(action.url, '_blank', 'noopener,noreferrer');
                    } else if (actionType === 'Action.Execute' || actionType === 'Action.Submit') {
                        const data = action.data || {};
                        const message = actionType === 'Action.Execute'
                            ? `Execute: ${action.verb || 'action'}`
                            : 'Form submitted';

                        chatContext?.sendMessage({
                            role: Role.User,
                            content: Object.keys(data).length > 0
                                ? `${message}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
                                : message
                        });
                    }
                };

                const element = card.render();
                if (element) {
                    element.style.backgroundColor = 'transparent';
                    element.style.border = 'none';
                    element.style.fontFamily = 'inherit';
                    setRenderedCard(element);
                } else {
                    setError('silent');
                    setRenderedCard(null);
                }
            } catch {
                // Silently handle errors - just show the code block
                setError('silent');
                setRenderedCard(null);
            }
        };

        // Debounce rendering to avoid excessive re-renders during streaming
        const timeoutId = setTimeout(renderCard, 300);

        return () => {
            clearTimeout(timeoutId);
        };
    }, [cardJson, isComplete, chatContext]);

    // Mount rendered card
    useEffect(() => {
        if (containerRef.current && renderedCard && !showCode) {
            containerRef.current.innerHTML = '';
            containerRef.current.appendChild(renderedCard);
        }
    }, [renderedCard, showCode]);

    const hasValidCard = renderedCard && !error;

    if (!isComplete) {
        return (
            <div className="relative my-4">
                <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-700 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
                    <span>adaptivecard</span>
                </div>
                <div className="bg-white dark:bg-neutral-800 p-4 rounded-b-md border border-gray-200 dark:border-neutral-700">
                    <div className="flex items-center justify-center h-24 text-gray-500 dark:text-neutral-500">
                        <div className="flex items-center space-x-3">
                            <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-gray-600 dark:border-neutral-600 dark:border-t-neutral-400"></div>
                            <span>Generating Content...</span>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Show generating content placeholder when we have content but no valid card yet (and not in error state)
    if (cardJson.trim() && !renderedCard && !error) {
        return (
            <div className="relative my-4">
                <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-700 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
                    <span>adaptivecard</span>
                    <div className="flex items-center gap-2">
                        <Button
                            onClick={() => setShowCode(!showCode)}
                            className="text-neutral-300 hover:text-white transition-colors"
                            title={showCode ? 'Show preview' : 'Show code'}
                        >
                            {showCode ? <Eye className="h-4" /> : <Code className="h-4" />}
                        </Button>
                        <CopyButton text={cardJson} />
                    </div>
                </div>
                <div className="bg-white dark:bg-neutral-800 rounded-b-md p-4">
                    {showCode ? (
                        <pre className="text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
                            <code>{cardJson}</code>
                        </pre>
                    ) : (
                        <div className="flex items-center justify-center h-24 text-gray-500 dark:text-neutral-500">
                            <div className="flex items-center space-x-3">
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-gray-600 dark:border-neutral-600 dark:border-t-neutral-400"></div>
                                <span>Generating Content...</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Show waiting placeholder when no content
    if (!cardJson.trim()) {
        return (
            <div className="relative my-4">
                <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-700 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
                    <span>adaptivecard</span>
                    <div className="flex items-center gap-2">
                        <Button
                            onClick={() => setShowCode(!showCode)}
                            className="text-neutral-300 hover:text-white transition-colors"
                            title={showCode ? 'Show preview' : 'Show code'}
                        >
                            {showCode ? <Eye className="h-4" /> : <Code className="h-4" />}
                        </Button>
                        <CopyButton text={cardJson} />
                    </div>
                </div>
                <div className="bg-white dark:bg-neutral-800 rounded-b-md p-4">
                    <div className="flex items-center justify-center h-24 text-gray-500 dark:text-neutral-500">
                        <div className="animate-pulse">Waiting for card data...</div>
                    </div>
                </div>
            </div>
        );
    }

    // Show error fallback with raw JSON
    if (error) {
        return (
            <div className="relative my-4">
                <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-700 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
                    <span>adaptivecard</span>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-red-500 dark:text-red-400 opacity-70">render failed</span>
                        <CopyButton text={cardJson} />
                    </div>
                </div>
                <div className="bg-white dark:bg-neutral-800 p-4 rounded-b-md border border-gray-200 dark:border-neutral-700">
                    <pre className="text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto">
                        <code>{cardJson}</code>
                    </pre>
                </div>
            </div>
        );
    }

    return (
        <div className="relative my-4">
            <div className="flex justify-between items-center bg-gray-100 dark:bg-neutral-700 pl-4 pr-2 py-1.5 rounded-t-md text-xs text-gray-700 dark:text-neutral-300">
                <span>adaptivecard</span>
                <div className="flex items-center gap-2">
                    {error && <span className="text-xs text-red-500 opacity-70">{error}</span>}
                    {hasValidCard && (
                        <Button
                            onClick={() => setShowCode(!showCode)}
                            className="text-neutral-300 hover:text-white transition-colors"
                            title={showCode ? 'Show preview' : 'Show code'}
                        >
                            {showCode ? <Eye className="h-4" /> : <Code className="h-4" />}
                        </Button>
                    )}
                    <CopyButton text={cardJson} />
                </div>
            </div>
            <div className="bg-white dark:bg-neutral-800 rounded-b-md p-4">
                <div
                    ref={containerRef}
                    className={`adaptive-card-container [&_.ac-container]:!bg-transparent [&_.ac-container]:!border-none [&_*]:text-gray-900 [&_*]:dark:text-neutral-100 ${hasValidCard && !showCode ? 'block' : 'hidden'
                        }`}
                />
                <pre className={`text-gray-800 dark:text-neutral-300 text-sm whitespace-pre-wrap overflow-x-auto ${hasValidCard && !showCode ? 'hidden' : 'block'
                    }`}>
                    <code>{cardJson}</code>
                </pre>
            </div>
        </div>
    );
};

export const CardRenderer = memo(
    NonMemoizedCardRenderer,
    (prevProps, nextProps) => prevProps.cardJson === nextProps.cardJson
);
