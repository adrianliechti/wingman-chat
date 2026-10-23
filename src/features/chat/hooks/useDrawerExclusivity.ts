import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface DrawerExclusivityOptions {
  showApp: boolean;
  setShowApp: (show: boolean) => void;
  appWidthVw: number;
  setAppWidthVw: (widthVw: number) => void;
  showArtifacts: boolean;
  setShowArtifacts: (show: boolean) => void;
  artifactsWidthVw: number;
  setArtifactsWidthVw: (widthVw: number) => void;
  showAgent: boolean;
  setShowAgent: (show: boolean) => void;
}

/**
 * Closes sibling drawers when one opens. Switching directly between the app and
 * artifacts panels is a swap: the incoming panel takes over the outgoing one's width
 * and both skip their slide/fade, so the tabs stay put and only the content changes.
 *
 * Returns `true` while such a swap settles, so panels and latches can suppress transitions.
 */
export function useDrawerExclusivity({
  showApp,
  setShowApp,
  appWidthVw,
  setAppWidthVw,
  showArtifacts,
  setShowArtifacts,
  artifactsWidthVw,
  setArtifactsWidthVw,
  showAgent,
  setShowAgent,
}: DrawerExclusivityOptions): boolean {
  const prevShowApp = useRef(showApp);
  const prevShowArtifacts = useRef(showArtifacts);
  const prevShowAgent = useRef(showAgent);

  const [swapping, setSwapping] = useState(false);
  const frameRef = useRef(0);

  // Transitions stay off until the swapped styles have been painted once.
  const beginSwap = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    setSwapping(true);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = requestAnimationFrame(() => setSwapping(false));
    });
  }, []);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  // Layout effects, so the swap flag lands before the first frame of the newly opened panel.
  useLayoutEffect(() => {
    if (showApp && !prevShowApp.current) {
      if (showArtifacts) {
        setAppWidthVw(artifactsWidthVw);
        beginSwap();
      }
      setShowArtifacts(false);
      if (window.innerWidth < 768) setShowAgent(false);
    }
    prevShowApp.current = showApp;
  }, [showApp, showArtifacts, artifactsWidthVw, setAppWidthVw, setShowArtifacts, setShowAgent, beginSwap]);

  useLayoutEffect(() => {
    if (showArtifacts && !prevShowArtifacts.current) {
      if (showApp) {
        setArtifactsWidthVw(appWidthVw);
        beginSwap();
      }
      setShowApp(false);
      if (window.innerWidth < 768) setShowAgent(false);
    }
    prevShowArtifacts.current = showArtifacts;
  }, [showArtifacts, showApp, appWidthVw, setArtifactsWidthVw, setShowApp, setShowAgent, beginSwap]);

  useEffect(() => {
    if (showAgent && !prevShowAgent.current && window.innerWidth < 768) {
      setShowArtifacts(false);
      setShowApp(false);
    }
    prevShowAgent.current = showAgent;
  }, [showAgent, setShowArtifacts, setShowApp]);

  return swapping;
}
