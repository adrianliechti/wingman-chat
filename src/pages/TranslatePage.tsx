import { useState } from "react";
import { Button, Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { PilcrowRightIcon, Loader2, PlusIcon, GlobeIcon } from "lucide-react";
import { translate } from "../lib/client";

const languages = [
  { code: "en", name: "English" },
  { code: "de", name: "German" },
  { code: "fr", name: "French" },
  { code: "it", name: "Italian" },
  { code: "es", name: "Spanish" },
];

export function TranslatePage() {
  const [sourceText, setSourceText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [targetLang, setTargetLang] = useState("en");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performTranslate = async (langToUse: string, textToTranslate: string) => {
    if (!textToTranslate.trim()) {
      setTranslatedText("");
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    setTranslatedText("");

    try {
      const result = await translate(langToUse, textToTranslate);
      setTranslatedText(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unknown error occurred during translation.");
      setTranslatedText("");
    } finally {
      setIsLoading(false);
    }
  };

  const handleTranslateButtonClick = () => {
    performTranslate(targetLang, sourceText); // Uses current targetLang from state
  };

  const handleLanguageChange = (newLangCode: string) => {
    setTargetLang(newLangCode);
    
    (async () => {
      await performTranslate(newLangCode, sourceText);
    })();
  };

  const handleReset = () => {
    setSourceText("");
    setTranslatedText("");
    setError(null);
  };

  return (
    <div className="h-full w-full flex flex-col items-center bg-neutral-100 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
      <div className="fixed top-2 left-2 z-20">
        <Menu>
          <MenuButton className="inline-flex items-center menu-button">
            <GlobeIcon size={16} className="mr-1" />
            <span>{languages.find(l => l.code === targetLang)?.name}</span>
          </MenuButton>
          <MenuItems
            transition
            anchor="bottom start"
            className="!max-h-[50vh] mt-2 w-48 rounded border bg-neutral-200 dark:bg-neutral-900 border-neutral-700 overflow-y-auto shadow-lg"
          >
            {languages.map((lang) => (
              <MenuItem key={lang.code}>
                <Button
                  onClick={() => handleLanguageChange(lang.code)}
                  className="group flex w-full items-center px-4 py-2 data-[focus]:bg-neutral-300 dark:text-neutral-200 dark:data-[focus]:bg-[#2c2c2e] cursor-pointer"
                >
                  {lang.name}
                </Button>
              </MenuItem>
            ))}
          </MenuItems>
        </Menu>
      </div>
      
      <div className="fixed top-2 right-2 z-20">
        <Button
          className="menu-button"
          onClick={handleReset}
          title="Clear translation"
        >
          <PlusIcon size={20} />
        </Button>
      </div>
      
      <main className="w-full flex flex-col md:flex-row items-stretch gap-4 flex-grow p-4 pt-16">
        <div className="flex-1 flex flex-col gap-2 relative">
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="Enter text to translate..."
            className="w-full flex-grow p-4 border rounded shadow-sm resize-none bg-neutral-50 dark:bg-neutral-800 border-neutral-300 dark:border-neutral-700 focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex flex-col items-center justify-center px-2">
          <button
            onClick={handleTranslateButtonClick}
            className="px-3 py-2 font-semibold rounded menu-button transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            title={`Translate to ${languages.find(l => l.code === targetLang)?.name}`}
            disabled={isLoading || !sourceText.trim()}
          >
            {isLoading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <PilcrowRightIcon />
            )}
          </button>
        </div>

        <div className="flex-1 flex flex-col gap-2 relative">
          <textarea
            value={translatedText}
            readOnly
            placeholder={error ? error : "Translation will appear here..."}
            className={`w-full flex-grow p-4 border rounded shadow-sm resize-none bg-neutral-200 dark:bg-neutral-700 border-neutral-300 dark:border-neutral-600 ${error ? 'placeholder-red-500 dark:placeholder-red-400' : ''}`}
          />
        </div>
      </main>
    </div>
  );
}

export default TranslatePage;
