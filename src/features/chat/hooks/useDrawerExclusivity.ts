import { useEffect, useRef } from "react";

interface DrawerExclusivityOptions {
  showApp: boolean;
  setShowApp: (show: boolean) => void;
  showArtifacts: boolean;
  setShowArtifacts: (show: boolean) => void;
  showAgent: boolean;
  setShowAgent: (show: boolean) => void;
}

/** Side-effect-only hook: closes sibling drawers when one opens. Returns nothing. */
export function useDrawerExclusivity({
  showApp,
  setShowApp,
  showArtifacts,
  setShowArtifacts,
  showAgent,
  setShowAgent,
}: DrawerExclusivityOptions): void {
  const prevShowApp = useRef(showApp);
  const prevShowArtifacts = useRef(showArtifacts);
  const prevShowAgent = useRef(showAgent);

  useEffect(() => {
    if (showApp && !prevShowApp.current) {
      setShowArtifacts(false);
      if (window.innerWidth < 768) setShowAgent(false);
    }
    prevShowApp.current = showApp;
  }, [showApp, setShowArtifacts, setShowAgent]);

  useEffect(() => {
    if (showArtifacts && !prevShowArtifacts.current) {
      setShowApp(false);
      if (window.innerWidth < 768) setShowAgent(false);
    }
    prevShowArtifacts.current = showArtifacts;
  }, [showArtifacts, setShowApp, setShowAgent]);

  useEffect(() => {
    if (showAgent && !prevShowAgent.current && window.innerWidth < 768) {
      setShowArtifacts(false);
      setShowApp(false);
    }
    prevShowAgent.current = showAgent;
  }, [showAgent, setShowArtifacts, setShowApp]);
}
