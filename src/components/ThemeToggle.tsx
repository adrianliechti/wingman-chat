import { Sun, Moon, SunMoon } from "lucide-react";
import { Button } from "@headlessui/react";
import { useTheme } from "../contexts/ThemeContext";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // Cycle through: light -> dark -> system -> light
  const handleToggle = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('system');
    else setTheme('light');
  };
  const getIcon = () => {
    if (theme === 'light') return <Sun size={20} />;
    if (theme === 'dark') return <Moon size={20} />;
    return <SunMoon size={20} />; // system mode
  };
  const getTitle = () => {
    if (theme === 'light') return 'Switch to dark mode';
    if (theme === 'dark') return 'Switch to system mode';
    return 'Switch to light mode';
  };

  return (
    <Button
      className="menu-button"
      onClick={handleToggle}
      title={getTitle()}
    >
      {getIcon()}
    </Button>
  );
}
